# shared-services account (infrastructure/01 §2): Terraform state, the container registry, CI roles for image
# builds and the public apex DNS zone. No customer data.

locals {
  name  = "archova-shared"
  acct6 = substr(var.account_id, 6, 6)

  # Image repositories. Add one per app as it gets a Dockerfile (realtime, worker, admin, site).
  repositories = ["api", "web", "migrate"]
}

# --- Terraform state -------------------------------------------------------------------------------------------

data "aws_iam_policy_document" "state_key" {
  statement {
    sid       = "Account"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${var.account_id}:root"]
    }
  }

  statement {
    sid       = "WorkloadAccountsUseForState"
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = [for a in values(var.workload_accounts) : "arn:aws:iam::${a}:root"]
    }
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["s3.ap-southeast-2.amazonaws.com"]
    }
  }
}

resource "aws_kms_key" "state" {
  description         = "Terraform state"
  enable_key_rotation = true
  policy              = data.aws_iam_policy_document.state_key.json
}

resource "aws_kms_alias" "state" {
  name          = "alias/${local.name}-tfstate"
  target_key_id = aws_kms_key.state.key_id
}

# Each workload account may touch only its own envs/<env>/ prefix; the roles in that account narrow it further.
data "aws_iam_policy_document" "state_access" {
  dynamic "statement" {
    for_each = var.workload_accounts
    content {
      sid       = "List${replace(title(statement.key), "-", "")}"
      actions   = ["s3:ListBucket"]
      resources = ["arn:aws:s3:::${local.name}-tfstate-${local.acct6}"]
      principals {
        type        = "AWS"
        identifiers = ["arn:aws:iam::${statement.value}:root"]
      }
      condition {
        test     = "StringLike"
        variable = "s3:prefix"
        values   = ["envs/${statement.key}/*"]
      }
    }
  }

  dynamic "statement" {
    for_each = var.workload_accounts
    content {
      sid       = "Objects${replace(title(statement.key), "-", "")}"
      actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
      resources = ["arn:aws:s3:::${local.name}-tfstate-${local.acct6}/envs/${statement.key}/*"]
      principals {
        type        = "AWS"
        identifiers = ["arn:aws:iam::${statement.value}:root"]
      }
    }
  }
}

module "state" {
  source                             = "../../modules/s3-bucket"
  name                               = "${local.name}-tfstate-${local.acct6}"
  kms_key_arn                        = aws_kms_key.state.arn
  noncurrent_version_expiration_days = 365
  policy_statements                  = [data.aws_iam_policy_document.state_access.json]
}

# --- Container registry ----------------------------------------------------------------------------------------

resource "aws_kms_key" "ecr" {
  description         = "ECR images"
  enable_key_rotation = true
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "Account"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${var.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "WorkloadAccountsPullImages"
        Effect    = "Allow"
        Principal = { AWS = [for a in values(var.workload_accounts) : "arn:aws:iam::${a}:root"] }
        Action    = ["kms:Decrypt", "kms:DescribeKey"]
        Resource  = "*"
        Condition = { StringEquals = { "kms:ViaService" = "ecr.ap-southeast-2.amazonaws.com" } }
      },
    ]
  })
}

resource "aws_ecr_repository" "this" {
  for_each             = toset(local.repositories)
  name                 = "archova/${each.key}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.ecr.arn
  }
}

# Workload accounts pull; only CI in this account pushes.
data "aws_iam_policy_document" "ecr_pull" {
  statement {
    sid     = "WorkloadAccountsPull"
    actions = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
    principals {
      type        = "AWS"
      identifiers = [for a in values(var.workload_accounts) : "arn:aws:iam::${a}:root"]
    }
  }
}

resource "aws_ecr_repository_policy" "this" {
  for_each   = aws_ecr_repository.this
  repository = each.value.name
  policy     = data.aws_iam_policy_document.ecr_pull.json
}

# Last 50 images per service; images promoted to prod (tag prod-*) are kept for a year (infrastructure/06 §2).
resource "aws_ecr_lifecycle_policy" "this" {
  for_each   = aws_ecr_repository.this
  repository = each.value.name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Images deployed to prod: keep 1 year"
        selection    = { tagStatus = "tagged", tagPrefixList = ["prod-"], countType = "sinceImagePushed", countUnit = "days", countNumber = 365 }
        action       = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Everything else: keep the last 50"
        selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 50 }
        action       = { type = "expire" }
      },
    ]
  })
}

# Images are replicated to Melbourne for DR (infrastructure/06 §2).
resource "aws_ecr_replication_configuration" "this" {
  replication_configuration {
    rule {
      destination {
        region      = "ap-southeast-4"
        registry_id = var.account_id
      }
    }
  }
}

# --- CI: image builds -------------------------------------------------------------------------------------------

data "aws_iam_policy_document" "ecr_push" {
  statement {
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    actions = [
      "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:CompleteLayerUpload", "ecr:DescribeImages",
      "ecr:DescribeImageScanFindings", "ecr:GetDownloadUrlForLayer", "ecr:InitiateLayerUpload", "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [for r in aws_ecr_repository.this : r.arn]
  }
  statement {
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.ecr.arn]
  }
}

module "github_oidc" {
  source      = "../../modules/github-oidc"
  name_prefix = local.name
  repository  = var.repository

  roles = {
    # Pull requests push pr-<n>-<sha>; main pushes <sha>. Promotion adds prod-<sha> (same digest).
    ecr-push = {
      subjects    = ["pull_request", "ref:refs/heads/main", "environment:prod"]
      policy_json = data.aws_iam_policy_document.ecr_push.json
    }
  }
}

# --- DNS ---------------------------------------------------------------------------------------------------------

resource "aws_route53_zone" "apex" {
  count = var.domain == null ? 0 : 1
  name  = var.domain
}

# Only Amazon may issue certificates for the domain (ACM for CloudFront and the ALBs).
resource "aws_route53_record" "caa" {
  count   = var.domain == null ? 0 : 1
  zone_id = aws_route53_zone.apex[0].zone_id
  name    = var.domain
  type    = "CAA"
  ttl     = 3600
  records = ["0 issue \"amazon.com\"", "0 issuewild \";\"", "0 iodef \"mailto:security@${var.domain}\""]
}

resource "aws_route53_record" "delegation" {
  for_each = var.domain == null ? {} : var.subdomain_name_servers
  zone_id  = aws_route53_zone.apex[0].zone_id
  name     = "${each.key}.${var.domain}"
  type     = "NS"
  ttl      = 3600
  records  = each.value
}

# prod's app. and api. records live in the apex zone; prod's terraform-apply role changes them through this role.
data "aws_iam_policy_document" "dns_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${var.workload_accounts["prod-cell1"]}:role/archova-prod-c1-gha-terraform-apply"]
    }
  }
}

resource "aws_iam_role" "dns_prod" {
  count              = var.domain == null ? 0 : 1
  name               = "${local.name}-dns-prod"
  assume_role_policy = data.aws_iam_policy_document.dns_trust.json
}

data "aws_iam_policy_document" "dns_prod" {
  count = var.domain == null ? 0 : 1
  statement {
    actions   = ["route53:ChangeResourceRecordSets", "route53:ListResourceRecordSets", "route53:GetHostedZone"]
    resources = [aws_route53_zone.apex[0].arn]
  }
  statement {
    actions   = ["route53:GetChange", "route53:ListHostedZones"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "dns_prod" {
  count  = var.domain == null ? 0 : 1
  name   = "apex-zone-records"
  role   = aws_iam_role.dns_prod[0].id
  policy = data.aws_iam_policy_document.dns_prod[0].json
}

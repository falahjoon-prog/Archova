# Task roles live here rather than in the ecs-service module so key policies (the BYO AI key) can name them
# without a dependency cycle.

locals {
  task_roles = toset(concat(keys(var.services), ["migrate"]))

  bedrock_au_resources = [
    "arn:aws:bedrock:ap-southeast-2::foundation-model/*",
    "arn:aws:bedrock:ap-southeast-4::foundation-model/*",
    "arn:aws:bedrock:ap-southeast-2:${local.account}:inference-profile/au.*",
    "arn:aws:bedrock:ap-southeast-2:${local.account}:application-inference-profile/*",
  ]
}

resource "aws_iam_role" "task" {
  for_each = local.task_roles
  name     = "${local.name}-${each.key}-task"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Condition = { StringEquals = { "aws:SourceAccount" = local.account } }
    }]
  })
  tags = merge(local.tags, { service = each.key })
}

# --- api -----------------------------------------------------------------------------------------------------

data "aws_iam_policy_document" "api" {
  statement {
    sid       = "Files"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload", "s3:GetObjectAttributes"]
    resources = ["${module.files.arn}/quarantine/*", "${module.files.arn}/orgs/*", "${module.exports.arn}/*"]
  }

  # Reads GuardDuty's scan tag on complete; CopyObject carries the tag to orgs/.../original.
  statement {
    sid       = "FilesScanTags"
    actions   = ["s3:GetObjectTagging", "s3:PutObjectTagging"]
    resources = ["${module.files.arn}/quarantine/*", "${module.files.arn}/orgs/*"]
  }

  statement {
    sid       = "FilesKey"
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey"]
    resources = [module.kms_files.arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["s3.${local.region}.amazonaws.com"]
    }
  }

  # X25: Australian models and the AU inference profile only. The VPC endpoint policy and an SCP say the same.
  statement {
    sid       = "BedrockInAustralia"
    actions   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:Converse", "bedrock:ConverseStream", "bedrock:CountTokens"]
    resources = local.bedrock_au_resources
  }

  # Nova reads scanned drawings and documents with Textract in Sydney (Ari, ai/02). DetectDocumentText has no
  # resource-level permissions, so the region is pinned instead.
  statement {
    sid       = "TextractInSydney"
    actions   = ["textract:DetectDocumentText"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = [local.region]
    }
  }

  # X28: assume a customer's BYO Bedrock role. Their trust policy requires our per-org ExternalId.
  statement {
    sid       = "AssumeCustomerByoRoles"
    actions   = ["sts:AssumeRole"]
    resources = ["arn:aws:iam::*:role/archova-byo-*"]
    condition {
      test     = "Null"
      variable = "sts:ExternalId"
      values   = ["false"]
    }
  }

  # X28: BYO AI provider secrets at archova/<env>/orgs/{orgId}/ai-provider under the dedicated key.
  statement {
    sid = "ByoProviderSecrets"
    actions = [
      "secretsmanager:CreateSecret", "secretsmanager:PutSecretValue", "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret", "secretsmanager:DeleteSecret", "secretsmanager:TagResource",
      "secretsmanager:ReplicateSecretToRegions",
    ]
    resources = ["arn:aws:secretsmanager:${local.region}:${local.account}:secret:archova/${var.env}/orgs/*"]
  }

  statement {
    sid       = "ByoProviderKey"
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey"]
    resources = [module.kms_ai_provider_secrets.arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${local.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "api" {
  name   = "api"
  role   = aws_iam_role.task["api"].id
  policy = data.aws_iam_policy_document.api.json
}

# --- ECS blue/green ------------------------------------------------------------------------------------------

resource "aws_iam_role" "ecs_infrastructure" {
  name = "${local.name}-ecs-infrastructure"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ecs.amazonaws.com" }
    }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "ecs_infrastructure" {
  role       = aws_iam_role.ecs_infrastructure.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonECSInfrastructureRolePolicyForLoadBalancers"
}

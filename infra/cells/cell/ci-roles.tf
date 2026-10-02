# Roles GitHub Actions assumes in this account through OIDC; no long-lived keys (infrastructure/03 §1, §7).
#
#   terraform-plan    any pull request             read-only, plans posted on the PR
#   terraform-apply   GitHub environment <env>-infra   applies after approval (dev applies on merge)
#   deploy            GitHub environment <env>         new task definitions, migrations, static assets
#
# SCPs still bound what terraform-apply can do (infra/org).

locals {
  state_key_prefix = "envs/${var.env == "prod" ? "prod-cell1" : var.env}/"

  deploy_passable_roles = concat(
    [for s in keys(var.services) : aws_iam_role.task[s].arn],
    [for s in keys(var.services) : module.service[s].execution_role_arn],
    [aws_iam_role.task["migrate"].arn, aws_iam_role.migrate_execution.arn],
  )
}

data "aws_iam_policy_document" "state_read" {
  count = var.ci == null ? 0 : 1

  statement {
    actions   = ["s3:ListBucket"]
    resources = [var.ci.state_bucket_arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["${local.state_key_prefix}*"]
    }
  }
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${var.ci.state_bucket_arn}/${local.state_key_prefix}*"]
  }
  # Lock files (S3 native locking).
  statement {
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["${var.ci.state_bucket_arn}/${local.state_key_prefix}*.tflock"]
  }
  statement {
    actions   = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"]
    resources = [var.ci.state_kms_key_arn]
  }
}

data "aws_iam_policy_document" "state_write" {
  count                   = var.ci == null ? 0 : 1
  source_policy_documents = [data.aws_iam_policy_document.state_read[0].json]

  statement {
    actions   = ["s3:PutObject"]
    resources = ["${var.ci.state_bucket_arn}/${local.state_key_prefix}*"]
  }
}

data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "TaskDefinitions"
    actions   = ["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition", "ecs:ListTaskDefinitions"]
    resources = ["*"]
  }

  statement {
    sid = "ServicesAndTasks"
    actions = [
      "ecs:UpdateService", "ecs:DescribeServices", "ecs:DescribeServiceDeployments", "ecs:ListServiceDeployments",
      "ecs:DescribeServiceRevisions", "ecs:RunTask", "ecs:DescribeTasks", "ecs:ListTasks", "ecs:StopTask",
    ]
    resources = ["*"]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.this.arn]
    }
  }

  statement {
    sid       = "PassServiceRoles"
    actions   = ["iam:PassRole"]
    resources = local.deploy_passable_roles
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  statement {
    sid       = "StaticAssets"
    actions   = ["s3:PutObject", "s3:ListBucket", "s3:GetObject"]
    resources = [module.static_web.arn, "${module.static_web.arn}/*"]
  }

  statement {
    sid       = "Invalidate"
    actions   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
    resources = [module.edge.app_distribution_arn]
  }

  statement {
    sid       = "Config"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = ["arn:aws:ssm:${local.region}:${local.account}:parameter/archova/${var.env}/*"]
  }

  statement {
    sid       = "MigrationLogs"
    actions   = ["logs:GetLogEvents", "logs:FilterLogEvents"]
    resources = ["${aws_cloudwatch_log_group.migrate.arn}:*"]
  }
}

module "github_oidc" {
  source          = "../../modules/github-oidc"
  count           = var.ci == null ? 0 : 1
  name_prefix     = local.name
  repository      = var.ci.repository
  create_provider = var.ci.create_oidc_provider

  roles = {
    terraform-plan = {
      subjects            = ["pull_request"]
      managed_policy_arns = ["arn:aws:iam::aws:policy/ReadOnlyAccess"]
      policy_json         = data.aws_iam_policy_document.state_read[0].json
    }
    terraform-apply = {
      subjects            = ["environment:${var.env}-infra"]
      managed_policy_arns = ["arn:aws:iam::aws:policy/AdministratorAccess"]
      policy_json         = data.aws_iam_policy_document.state_write[0].json
    }
    deploy = {
      subjects    = ["environment:${var.env}"]
      policy_json = data.aws_iam_policy_document.deploy.json
    }
  }

  tags = local.tags
}

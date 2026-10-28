# Roles GitHub Actions assumes in this account through OIDC; no long-lived keys (infrastructure/03 §1, §7).
#
#   deploy            GitHub environment <env>         new task definitions, migrations, static assets
#
# The OIDC provider and the Terraform plan and apply roles come from infra/bootstrap/github-actions.yaml, so
# Terraform never manages the role it runs as. SCPs still bound what the apply role can do (infra/org).

locals {
  deploy_passable_roles = concat(
    [for s in keys(var.services) : aws_iam_role.task[s].arn],
    [for s in keys(var.services) : module.service[s].execution_role_arn],
    [aws_iam_role.task["worker"].arn, module.worker.execution_role_arn],
    [aws_iam_role.task["ai-worker"].arn, module.ai_worker.execution_role_arn],
    [aws_iam_role.files_worker.arn, module.files_worker.execution_role_arn],
    [aws_iam_role.task["migrate"].arn, aws_iam_role.migrate_execution.arn, aws_iam_role.db_roles_execution.arn],
  )
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
  create_provider = false

  roles = {
    deploy = {
      subjects    = ["environment:${var.env}"]
      policy_json = data.aws_iam_policy_document.deploy.json
    }
  }

  tags = local.tags
}

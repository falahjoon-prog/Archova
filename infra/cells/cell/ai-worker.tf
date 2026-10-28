# The AI worker (apps/worker with WORKER_ROLE=ai): renders drawing pages and runs Nova's vision pass. Same job
# bootstrap as the worker, in the restricted subnets behind the egress allow-list like the api (X25), with the
# api's AI permissions but read-only on files and on BYO provider secrets. No inbound port, so no ALB and a plain
# rolling update. Sized for pages rendered at about 2,000 px on the longest edge.

locals {
  ai_worker = {
    cpu     = 1024
    memory  = 4096
    min     = 1
    max     = 2
    desired = 1
  }
}

data "aws_iam_policy_document" "ai_worker" {
  statement {
    sid       = "FilesRead"
    actions   = ["s3:GetObject", "s3:GetObjectAttributes"]
    resources = ["${module.files.arn}/orgs/*"]
  }

  statement {
    sid       = "FilesKey"
    actions   = ["kms:Decrypt"]
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

  # X28: assume a customer's BYO Bedrock role, and read their provider secret. Read only: the api writes them.
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

  statement {
    sid       = "ByoProviderSecretsRead"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = ["arn:aws:secretsmanager:${local.region}:${local.account}:secret:archova/${var.env}/orgs/*"]
  }

  statement {
    sid       = "ByoProviderKeyRead"
    actions   = ["kms:Decrypt"]
    resources = [module.kms_ai_provider_secrets.arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${local.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "ai_worker" {
  name   = "ai-worker"
  role   = aws_iam_role.task["ai-worker"].id
  policy = data.aws_iam_policy_document.ai_worker.json
}

module "ai_worker" {
  source = "../../modules/ecs-service"

  name         = local.svc["ai-worker"]
  service      = "ai-worker"
  cluster_arn  = aws_ecs_cluster.this.arn
  cluster_name = aws_ecs_cluster.this.name
  vpc_id       = module.network.vpc_id
  subnet_ids   = module.network.restricted_subnet_ids
  image        = var.images["ai-worker"]
  cpu          = local.ai_worker.cpu
  memory       = local.ai_worker.memory
  environment = merge({
    NODE_ENV        = "production"
    LOG_LEVEL       = "info"
    WORKER_ROLE     = "ai"
    API_AI_PROVIDER = "bedrock"
    API_AI_REGION   = local.region
  }, local.ai_model_env)
  secrets = {
    DATABASE_URL          = "${module.aurora.role_secret_arns["app_rw"]}:url::"
    DATABASE_PLATFORM_URL = "${module.aurora.role_secret_arns["app_platform"]}:url::"
    REDIS_URL             = "${module.valkey_queue.secret_arn}:url::"
  }
  secret_arns = [
    module.aurora.role_secret_arns["app_rw"],
    module.aurora.role_secret_arns["app_platform"],
    module.valkey_queue.secret_arn,
  ]
  secrets_kms_key_arn      = module.kms_secrets.arn
  task_role_arn            = aws_iam_role.task["ai-worker"].arn
  readonly_root_filesystem = true
  desired_count            = local.ai_worker.desired
  min_count                = local.ai_worker.min
  max_count                = local.ai_worker.max
  enable_execute_command   = var.enable_execute_command
  logs_kms_key_arn         = module.kms_logs.arn
  log_retention_days       = var.log_retention_days

  tags = merge(local.tags, { service = "ai-worker" })
}

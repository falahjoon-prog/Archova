# The files worker (Ben, apps/worker with file jobs switched on): moves infected and unscannable uploads from quarantine/
# to threats/, where they stay 30 days for review (Sam; the lifecycle rule is on the files bucket in storage.tf). It is the
# worker image run a second time with WORKER_FILES_STORE=s3 in a role of its own, because the bucket policy (malware.tf)
# denies reading quarantine/ to everyone except GuardDuty and a role named archova-<env>-<cell>-files-worker. The
# general worker therefore never gets that exemption. Legal holds and ID-image deletion get their own roles later.

resource "aws_iam_role" "files_worker" {
  name = "${local.name}-files-worker"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Condition = { StringEquals = { "aws:SourceAccount" = local.account } }
    }]
  })
  tags = merge(local.tags, { service = "files-worker" })
}

data "aws_iam_policy_document" "files_worker" {
  # CopyObject reads the source with its tags (the infected ones included, which the bucket policy lets this role do).
  statement {
    sid       = "QuarantineMove"
    actions   = ["s3:GetObject", "s3:GetObjectTagging", "s3:DeleteObject"]
    resources = ["${module.files.arn}/quarantine/*"]
  }

  statement {
    sid       = "ThreatsWriteOnly"
    actions   = ["s3:PutObject", "s3:PutObjectTagging"]
    resources = ["${module.files.arn}/threats/*"]
  }

  statement {
    sid       = "FilesKey"
    actions   = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"]
    resources = [module.kms_files.arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["s3.${local.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "files_worker" {
  name   = "files-worker"
  role   = aws_iam_role.files_worker.id
  policy = data.aws_iam_policy_document.files_worker.json
}

module "files_worker" {
  source = "../../modules/ecs-service"

  name         = local.svc["files-worker"]
  service      = "files-worker"
  cluster_arn  = aws_ecs_cluster.this.arn
  cluster_name = aws_ecs_cluster.this.name
  vpc_id       = module.network.vpc_id
  subnet_ids   = module.network.private_subnet_ids
  image        = var.images["worker"]
  cpu          = 256
  memory       = 512
  environment = {
    NODE_ENV            = "production"
    LOG_LEVEL           = "info"
    WORKER_FILES_STORE  = "s3"
    WORKER_FILES_BUCKET = module.files.id
    WORKER_FILES_REGION = local.region
  }
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
  task_role_arn            = aws_iam_role.files_worker.arn
  readonly_root_filesystem = true
  desired_count            = 1
  min_count                = 1
  max_count                = 1
  enable_execute_command   = var.enable_execute_command
  logs_kms_key_arn         = module.kms_logs.arn
  log_retention_days       = var.log_retention_days

  tags = merge(local.tags, { service = "files-worker" })
}

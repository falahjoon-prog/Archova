# Customer-managed keys per data class per environment (infrastructure/01 §6, X21). Pooled tenants share these
# keys with org_id as the encryption context.

module "kms_db" {
  source      = "../../modules/kms-key"
  alias       = "${local.name}-db"
  description = "Aurora storage, snapshots and Performance Insights (${local.name})"
  tags        = local.tags
}

module "kms_files" {
  source      = "../../modules/kms-key"
  alias       = "${local.name}-files"
  description = "S3 files, exports and inbound mail (${local.name})"
  # The drawing tiles CDN (files-cdn.tf) reads tiles from the files bucket through origin access control.
  allow_cloudfront_distributions = var.files_cdn != null
  tags                           = local.tags
}

module "kms_backups" {
  source      = "../../modules/kms-key"
  alias       = "${local.name}-backups"
  description = "Local AWS Backup vault (${local.name})"
  tags        = local.tags
}

module "kms_logs" {
  source                = "../../modules/kms-key"
  alias                 = "${local.name}-logs"
  description           = "CloudWatch log groups, firewall and alarm topics (${local.name})"
  allow_cloudwatch_logs = true
  service_principals    = ["cloudwatch.amazonaws.com", "events.amazonaws.com"]
  tags                  = local.tags
}

module "kms_secrets" {
  source       = "../../modules/kms-key"
  alias        = "${local.name}-secrets"
  description  = "Secrets Manager: database, Valkey and signing keys (${local.name})"
  multi_region = var.env == "prod"
  tags         = local.tags
}

# BYO AI provider secrets (X28): one key per environment, used for nothing else. Only the api (and later the
# ai-worker) task role may decrypt, and only through Secrets Manager; administrators can manage but not decrypt.
# Multi-Region so a Melbourne replica exists for DR.
module "kms_ai_provider_secrets" {
  source                 = "../../modules/kms-key"
  alias                  = "archova-${var.env}-ai-provider-secrets"
  description            = "BYO AI provider credentials (X28), ${var.env}"
  admin_only_for_account = true
  usage_role_arns        = [aws_iam_role.task["api"].arn]
  usage_via_services     = ["secretsmanager.${local.region}.amazonaws.com"]
  multi_region           = true
  tags                   = merge(local.tags, { service = "ai" })
}

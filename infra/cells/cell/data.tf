# Aurora PostgreSQL 16 and Valkey (infrastructure/01 §6, 02 §3).

locals {
  # Everything that talks to the database or Valkey.
  data_clients = {
    api     = module.service["api"].security_group_id
    worker  = module.worker.security_group_id
    ai      = module.ai_worker.security_group_id
    migrate = aws_security_group.migrate.id
  }
}

module "aurora" {
  source                        = "../../modules/aurora"
  name                          = "${local.name}-aurora"
  vpc_id                        = module.network.vpc_id
  subnet_ids                    = module.network.data_subnet_ids
  client_security_groups        = local.data_clients
  instance_class                = var.aurora.instance_class
  instance_count                = var.aurora.instance_count
  serverless_min_acu            = var.aurora.serverless_min_acu
  serverless_max_acu            = var.aurora.serverless_max_acu
  serverless_auto_pause_seconds = var.aurora.auto_pause_seconds
  io_optimized                  = var.aurora.io_optimized
  backup_retention_days         = var.aurora.backup_retention_days
  enable_proxy                  = var.aurora.enable_proxy
  deletion_protection           = var.deletion_protection
  skip_final_snapshot           = !var.deletion_protection
  kms_key_arn                   = module.kms_db.arn
  secrets_kms_key_arn           = module.kms_secrets.arn
  logs_kms_key_arn              = module.kms_logs.arn
  log_retention_days            = var.log_retention_days
  tags                          = merge(local.tags, { service = "aurora" })
}

# Queue cluster: BullMQ jobs, domain events (X19), sessions, revocation markers and Idempotency-Keys. noeviction,
# because none of that may silently disappear.
module "valkey_queue" {
  source                  = "../../modules/valkey"
  name                    = "${local.name}-valkey-${var.valkey.split ? "queue" : "shared"}"
  purpose                 = var.valkey.split ? "queue" : "shared"
  vpc_id                  = module.network.vpc_id
  subnet_ids              = module.network.data_subnet_ids
  client_security_groups  = local.data_clients
  node_type               = var.valkey.queue_node_type
  replicas                = var.valkey.replicas
  snapshot_retention_days = var.valkey.queue_snapshot_days
  kms_key_arn             = module.kms_db.arn
  logs_kms_key_arn        = module.kms_logs.arn
  secrets_kms_key_arn     = module.kms_secrets.arn
  tags                    = merge(local.tags, { service = "valkey" })
}

# Cache cluster: disposable caches only (permission cache, rendered fragments). allkeys-lru.
module "valkey_cache" {
  source                 = "../../modules/valkey"
  count                  = var.valkey.split ? 1 : 0
  name                   = "${local.name}-valkey-cache"
  purpose                = "cache"
  vpc_id                 = module.network.vpc_id
  subnet_ids             = module.network.data_subnet_ids
  client_security_groups = local.data_clients
  node_type              = coalesce(var.valkey.cache_node_type, var.valkey.queue_node_type)
  replicas               = var.valkey.replicas
  kms_key_arn            = module.kms_db.arn
  logs_kms_key_arn       = module.kms_logs.arn
  secrets_kms_key_arn    = module.kms_secrets.arn
  tags                   = merge(local.tags, { service = "valkey" })
}

# The API's JWT signing key (ES256 private JWK). Terraform creates the empty secret; the key-rotation runbook
# generates the key and publishes the next one in JWKS before switching (README "Secrets").
resource "aws_secretsmanager_secret" "jwt_signing_key" {
  name                    = "archova/${local.name}/api-jwt-private-jwk"
  description             = "API_JWT_PRIVATE_JWK for ${local.name}"
  kms_key_id              = module.kms_secrets.arn
  recovery_window_in_days = 7
  tags                    = merge(local.tags, { service = "api" })
}

# ElastiCache for Valkey, cluster mode disabled (BullMQ needs it), TLS and AUTH on (infrastructure/01 §6, X19).

locals {
  tags = merge(var.tags, { "archova:component" = "valkey-${var.purpose}" })
}

resource "aws_elasticache_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
  tags       = local.tags
}

resource "aws_security_group" "this" {
  name        = var.name
  description = "Valkey ${var.purpose}: from app tasks only"
  vpc_id      = var.vpc_id
  tags        = merge(local.tags, { Name = var.name })
}

resource "aws_vpc_security_group_ingress_rule" "clients" {
  for_each                     = var.client_security_groups
  security_group_id            = aws_security_group.this.id
  description                  = "Valkey from app tasks"
  referenced_security_group_id = each.value
  from_port                    = 6379
  to_port                      = 6379
  ip_protocol                  = "tcp"
}

resource "aws_elasticache_parameter_group" "this" {
  name   = var.name
  family = "valkey8"

  parameter {
    name  = "maxmemory-policy"
    value = var.purpose == "cache" ? "allkeys-lru" : "noeviction"
  }

  # Session revocation is published on identity:session-revoked; keyspace events are not needed.
  tags = local.tags
}

ephemeral "aws_secretsmanager_random_password" "auth" {
  password_length     = 64
  exclude_punctuation = true
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id       = var.name
  description                = "Archova ${var.purpose}"
  engine                     = "valkey"
  engine_version             = var.engine_version
  node_type                  = var.node_type
  num_cache_clusters         = 1 + var.replicas
  automatic_failover_enabled = var.replicas > 0
  multi_az_enabled           = var.replicas > 0
  parameter_group_name       = aws_elasticache_parameter_group.this.name
  subnet_group_name          = aws_elasticache_subnet_group.this.name
  security_group_ids         = [aws_security_group.this.id]
  port                       = 6379
  at_rest_encryption_enabled = true
  kms_key_id                 = var.kms_key_arn
  transit_encryption_enabled = true
  auth_token_wo              = ephemeral.aws_secretsmanager_random_password.auth.random_password
  auth_token_wo_version      = var.credentials_version
  auto_minor_version_upgrade = true
  snapshot_retention_limit   = var.snapshot_retention_days
  snapshot_window            = "16:00-17:00"
  maintenance_window         = "sun:17:00-sun:18:00"
  apply_immediately          = false

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.slow.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "slow-log"
  }

  tags = local.tags
}

resource "aws_cloudwatch_log_group" "slow" {
  name              = "/archova/${var.name}/slow-log"
  retention_in_days = 90
  kms_key_id        = var.logs_kms_key_arn
  tags              = local.tags
}

# {token, host, url}; ECS injects url into API_REDIS_URL (or the worker's queue URL).
resource "aws_secretsmanager_secret" "this" {
  name                    = "archova/${var.name}"
  description             = "Valkey ${var.purpose} connection"
  kms_key_id              = var.secrets_kms_key_arn
  recovery_window_in_days = 7
  tags                    = local.tags
}

resource "aws_secretsmanager_secret_version" "this" {
  secret_id = aws_secretsmanager_secret.this.id
  secret_string_wo = jsonencode({
    token = ephemeral.aws_secretsmanager_random_password.auth.random_password
    host  = aws_elasticache_replication_group.this.primary_endpoint_address
    url   = "rediss://:${ephemeral.aws_secretsmanager_random_password.auth.random_password}@${aws_elasticache_replication_group.this.primary_endpoint_address}:6379"
  })
  secret_string_wo_version = var.credentials_version
}

# Aurora PostgreSQL 16 for one cell (infrastructure/01 §6). Tenancy is row-level security; the app connects as
# app_rw through RDS Proxy in transaction mode, which is safe because tenant context is SET LOCAL only (X20).

locals {
  serverless = var.instance_class == "db.serverless"
  tags       = merge(var.tags, { "archova:component" = "aurora" })
}

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
  tags       = local.tags
}

resource "aws_security_group" "db" {
  name        = var.name
  description = "Aurora: PostgreSQL from app tasks and RDS Proxy only"
  vpc_id      = var.vpc_id
  tags        = merge(local.tags, { Name = var.name })
}

resource "aws_vpc_security_group_ingress_rule" "db_from_clients" {
  for_each                     = var.client_security_groups
  security_group_id            = aws_security_group.db.id
  description                  = "PostgreSQL from app tasks"
  referenced_security_group_id = each.value
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "db_from_proxy" {
  count                        = var.enable_proxy ? 1 : 0
  security_group_id            = aws_security_group.db.id
  description                  = "PostgreSQL from RDS Proxy"
  referenced_security_group_id = aws_security_group.proxy[0].id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "aws_rds_cluster_parameter_group" "this" {
  name        = var.name
  family      = "aurora-postgresql16"
  description = "Archova cluster parameters"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements"
    apply_method = "pending-reboot"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  parameter {
    name  = "log_lock_waits"
    value = "1"
  }

  # Migrations set their own lock_timeout (infrastructure/03 §5); this is the backstop for everything else.
  parameter {
    name  = "idle_in_transaction_session_timeout"
    value = "60000"
  }

  tags = local.tags
}

resource "aws_rds_cluster" "this" {
  cluster_identifier                  = var.name
  engine                              = "aurora-postgresql"
  engine_version                      = var.engine_version
  database_name                       = var.database_name
  master_username                     = "archova_admin"
  manage_master_user_password         = true
  master_user_secret_kms_key_id       = var.secrets_kms_key_arn
  db_subnet_group_name                = aws_db_subnet_group.this.name
  vpc_security_group_ids              = [aws_security_group.db.id]
  db_cluster_parameter_group_name     = aws_rds_cluster_parameter_group.this.name
  storage_type                        = var.io_optimized ? "aurora-iopt1" : null
  storage_encrypted                   = true
  kms_key_id                          = var.kms_key_arn
  backup_retention_period             = var.backup_retention_days
  preferred_backup_window             = "15:00-16:00" # 1-2am AEST
  preferred_maintenance_window        = "sun:16:00-sun:17:00"
  copy_tags_to_snapshot               = true
  deletion_protection                 = var.deletion_protection
  skip_final_snapshot                 = var.skip_final_snapshot
  final_snapshot_identifier           = var.skip_final_snapshot ? null : "${var.name}-final"
  iam_database_authentication_enabled = true
  enabled_cloudwatch_logs_exports     = ["postgresql"]

  dynamic "serverlessv2_scaling_configuration" {
    for_each = local.serverless ? [1] : []
    content {
      min_capacity             = var.serverless_min_acu
      max_capacity             = var.serverless_max_acu
      seconds_until_auto_pause = var.serverless_min_acu == 0 ? var.serverless_auto_pause_seconds : null
    }
  }

  tags = local.tags

  lifecycle {
    ignore_changes = [engine_version] # minor upgrades are automatic
  }
}

resource "aws_iam_role" "monitoring" {
  count = var.monitoring_interval > 0 ? 1 : 0
  name  = "${var.name}-monitoring"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "monitoring.rds.amazonaws.com" }
    }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "monitoring" {
  count      = var.monitoring_interval > 0 ? 1 : 0
  role       = aws_iam_role.monitoring[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

resource "aws_rds_cluster_instance" "this" {
  count                                 = var.instance_count
  identifier                            = "${var.name}-${count.index + 1}"
  cluster_identifier                    = aws_rds_cluster.this.id
  engine                                = aws_rds_cluster.this.engine
  instance_class                        = var.instance_class
  db_subnet_group_name                  = aws_db_subnet_group.this.name
  auto_minor_version_upgrade            = true
  performance_insights_enabled          = true
  performance_insights_kms_key_id       = var.kms_key_arn
  performance_insights_retention_period = 7
  monitoring_interval                   = var.monitoring_interval
  monitoring_role_arn                   = var.monitoring_interval > 0 ? aws_iam_role.monitoring[0].arn : null
  promotion_tier                        = count.index
  copy_tags_to_snapshot                 = true
  tags                                  = local.tags
}

resource "aws_cloudwatch_log_group" "postgresql" {
  name              = "/aws/rds/cluster/${var.name}/postgresql"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.logs_kms_key_arn
  tags              = local.tags
}

# RDS Proxy pools the api's connections (each task keeps ~10; 60 tasks multiplex onto ~150-250 database
# connections, infrastructure/04 §3).

resource "aws_security_group" "proxy" {
  count       = var.enable_proxy ? 1 : 0
  name        = "${var.name}-proxy"
  description = "RDS Proxy: PostgreSQL from app tasks"
  vpc_id      = var.vpc_id
  tags        = merge(local.tags, { Name = "${var.name}-proxy" })
}

resource "aws_vpc_security_group_ingress_rule" "proxy_from_clients" {
  for_each                     = var.enable_proxy ? var.client_security_groups : {}
  security_group_id            = aws_security_group.proxy[0].id
  description                  = "PostgreSQL from app tasks"
  referenced_security_group_id = each.value
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "proxy_to_db" {
  count                        = var.enable_proxy ? 1 : 0
  security_group_id            = aws_security_group.proxy[0].id
  description                  = "To Aurora"
  referenced_security_group_id = aws_security_group.db.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "aws_iam_role" "proxy" {
  count = var.enable_proxy ? 1 : 0
  name  = "${var.name}-proxy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "rds.amazonaws.com" }
    }]
  })
  tags = local.tags
}

data "aws_iam_policy_document" "proxy" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [for r in var.proxied_roles : aws_secretsmanager_secret.role[r].arn]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [var.secrets_kms_key_arn]
    condition {
      test     = "StringLike"
      variable = "kms:ViaService"
      values   = ["secretsmanager.*.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "proxy" {
  count  = var.enable_proxy ? 1 : 0
  name   = "read-role-secrets"
  role   = aws_iam_role.proxy[0].id
  policy = data.aws_iam_policy_document.proxy.json
}

resource "aws_db_proxy" "this" {
  count                  = var.enable_proxy ? 1 : 0
  name                   = var.name
  engine_family          = "POSTGRESQL"
  role_arn               = aws_iam_role.proxy[0].arn
  vpc_subnet_ids         = var.subnet_ids
  vpc_security_group_ids = [aws_security_group.proxy[0].id]
  require_tls            = true
  idle_client_timeout    = 1800

  dynamic "auth" {
    for_each = var.proxied_roles
    content {
      auth_scheme = "SECRETS"
      iam_auth    = "DISABLED"
      secret_arn  = aws_secretsmanager_secret.role[auth.value].arn
      description = auth.value
    }
  }

  tags = local.tags
}

resource "aws_db_proxy_default_target_group" "this" {
  count         = var.enable_proxy ? 1 : 0
  db_proxy_name = aws_db_proxy.this[0].name

  connection_pool_config {
    max_connections_percent      = 75
    max_idle_connections_percent = 25
    connection_borrow_timeout    = 30
  }
}

resource "aws_db_proxy_target" "this" {
  count                 = var.enable_proxy ? 1 : 0
  db_proxy_name         = aws_db_proxy.this[0].name
  target_group_name     = aws_db_proxy_default_target_group.this[0].name
  db_cluster_identifier = aws_rds_cluster.this.cluster_identifier
}

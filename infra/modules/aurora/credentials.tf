# One Secrets Manager secret per application role. Passwords are generated at apply time and written with
# write-only arguments, so they never appear in Terraform state or plans. The db-roles task (deploy pipeline)
# reads these secrets and the RDS-managed master secret and creates or updates the roles to match.
#
# Each secret holds {username, password, host, port, dbname, url}. ECS injects single keys, e.g. url into
# API_DATABASE_URL. app_migrator points at the writer; the other roles point at RDS Proxy when it is enabled.

ephemeral "aws_secretsmanager_random_password" "role" {
  for_each            = toset(var.app_roles)
  password_length     = 40
  exclude_punctuation = true
}

locals {
  role_host = {
    for r in var.app_roles :
    r => var.enable_proxy && contains(var.proxied_roles, r) ? aws_db_proxy.this[0].endpoint : aws_rds_cluster.this.endpoint
  }
}

resource "aws_secretsmanager_secret" "role" {
  for_each                = toset(var.app_roles)
  name                    = "archova/${var.name}/${each.key}"
  description             = "Aurora login for ${each.key}"
  kms_key_id              = var.secrets_kms_key_arn
  recovery_window_in_days = 7
  tags                    = local.tags
}

resource "aws_secretsmanager_secret_version" "role" {
  for_each  = toset(var.app_roles)
  secret_id = aws_secretsmanager_secret.role[each.key].id
  secret_string_wo = jsonencode({
    username = each.key
    password = ephemeral.aws_secretsmanager_random_password.role[each.key].random_password
    host     = local.role_host[each.key]
    port     = 5432
    dbname   = var.database_name
    url      = "postgres://${each.key}:${ephemeral.aws_secretsmanager_random_password.role[each.key].random_password}@${local.role_host[each.key]}:5432/${var.database_name}?sslmode=require"
  })
  secret_string_wo_version = var.credentials_version
}

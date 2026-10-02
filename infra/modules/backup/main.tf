# AWS Backup in a workload account (infrastructure/06 §2): daily, monthly and yearly recovery points, each copied
# to the separate backup account's vaults (Vault Lock, Sydney and Melbourne). Aurora PITR is configured on the
# cluster itself.

resource "aws_backup_vault" "local" {
  name        = var.name
  kms_key_arn = var.kms_key_arn
  tags        = var.tags
}

locals {
  rules = concat(
    [{ name = "daily", schedule = "cron(0 16 * * ? *)", days = var.daily_retention_days }],
    var.monthly_retention_days > 0 ? [{ name = "monthly", schedule = "cron(0 17 1 * ? *)", days = var.monthly_retention_days }] : [],
    var.yearly_retention_days > 0 ? [{ name = "yearly", schedule = "cron(0 18 1 1 ? *)", days = var.yearly_retention_days }] : [],
  )
}

resource "aws_backup_plan" "this" {
  name = var.name

  dynamic "rule" {
    for_each = local.rules
    content {
      rule_name         = rule.value.name
      target_vault_name = aws_backup_vault.local.name
      schedule          = rule.value.schedule # UTC; 16:00 is 2-3am in Sydney
      start_window      = 60
      completion_window = 360

      lifecycle {
        delete_after = rule.value.days
      }

      dynamic "copy_action" {
        for_each = var.copy_to_vault_arns
        content {
          destination_vault_arn = copy_action.value
          lifecycle {
            delete_after = rule.value.days
          }
        }
      }
    }
  }

  tags = var.tags
}

resource "aws_iam_role" "backup" {
  name = "${var.name}-backup"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "backup.amazonaws.com" }
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "backup" {
  for_each = toset([
    "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup",
    "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores",
  ])
  role       = aws_iam_role.backup.name
  policy_arn = each.value
}

resource "aws_backup_selection" "this" {
  name         = var.name
  plan_id      = aws_backup_plan.this.id
  iam_role_arn = aws_iam_role.backup.arn
  resources    = var.resource_arns
}

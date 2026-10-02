# One customer-managed key per data class per environment (infrastructure/01 §6, X21).

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

locals {
  root = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"

  # Everything except using the key, for keys whose data even administrators must not read.
  admin_actions = [
    "kms:Create*", "kms:Describe*", "kms:Enable*", "kms:List*", "kms:Put*", "kms:Update*", "kms:Revoke*",
    "kms:Disable*", "kms:Get*", "kms:Delete*", "kms:TagResource", "kms:UntagResource", "kms:ScheduleKeyDeletion",
    "kms:CancelKeyDeletion", "kms:ReplicateKey", "kms:RotateKeyOnDemand",
  ]
  usage_actions = ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:DescribeKey"]
}

data "aws_iam_policy_document" "this" {
  statement {
    sid       = "AccountAdministration"
    actions   = var.admin_only_for_account ? local.admin_actions : ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = [local.root]
    }
  }

  dynamic "statement" {
    for_each = length(var.usage_role_arns) > 0 ? [1] : []
    content {
      sid       = "UseByRoles"
      actions   = concat(local.usage_actions, ["kms:CreateGrant"])
      resources = ["*"]
      principals {
        type        = "AWS"
        identifiers = var.usage_role_arns
      }
      dynamic "condition" {
        for_each = length(var.usage_via_services) > 0 ? [1] : []
        content {
          test     = "StringEquals"
          variable = "kms:ViaService"
          values   = var.usage_via_services
        }
      }
    }
  }

  dynamic "statement" {
    for_each = length(var.service_principals) > 0 ? [1] : []
    content {
      sid       = "UseByServicesInThisAccount"
      actions   = local.usage_actions
      resources = ["*"]
      principals {
        type        = "Service"
        identifiers = var.service_principals
      }
      condition {
        test     = "StringEquals"
        variable = "aws:SourceAccount"
        values   = [data.aws_caller_identity.current.account_id]
      }
    }
  }

  dynamic "statement" {
    for_each = var.allow_cloudwatch_logs ? [1] : []
    content {
      sid       = "CloudWatchLogsInThisAccount"
      actions   = local.usage_actions
      resources = ["*"]
      principals {
        type        = "Service"
        identifiers = ["logs.${data.aws_region.current.region}.amazonaws.com"]
      }
      condition {
        test     = "ArnLike"
        variable = "kms:EncryptionContext:aws:logs:arn"
        values   = ["arn:${data.aws_partition.current.partition}:logs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:*"]
      }
    }
  }
}

resource "aws_kms_key" "this" {
  description             = var.description
  enable_key_rotation     = true
  rotation_period_in_days = 365
  multi_region            = var.multi_region
  deletion_window_in_days = var.deletion_window_in_days
  policy                  = data.aws_iam_policy_document.this.json
  tags                    = var.tags
}

resource "aws_kms_alias" "this" {
  name          = "alias/${var.alias}"
  target_key_id = aws_kms_key.this.key_id
}

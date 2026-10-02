# GitHub Actions -> AWS through OIDC, scoped per repository, branch and GitHub environment (infrastructure/03 §1).

data "aws_iam_openid_connect_provider" "existing" {
  count = var.create_provider ? 0 : 1
  url   = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_openid_connect_provider" "github" {
  count          = var.create_provider ? 1 : 0
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  tags           = var.tags
}

locals {
  provider_arn = var.create_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.existing[0].arn
}

data "aws_iam_policy_document" "trust" {
  for_each = var.roles

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [for s in each.value.subjects : "repo:${var.repository}:${s}"]
    }
  }
}

resource "aws_iam_role" "this" {
  for_each             = var.roles
  name                 = "${var.name_prefix}-gha-${each.key}"
  assume_role_policy   = data.aws_iam_policy_document.trust[each.key].json
  max_session_duration = each.value.max_session_seconds
  tags                 = var.tags
}

resource "aws_iam_role_policy" "this" {
  for_each = { for k, r in var.roles : k => r if r.policy_json != null }
  name     = "github-actions"
  role     = aws_iam_role.this[each.key].id
  policy   = each.value.policy_json
}

resource "aws_iam_role_policy_attachment" "this" {
  for_each = merge([
    for k, r in var.roles : { for arn in r.managed_policy_arns : "${k}|${arn}" => { role = k, arn = arn } }
  ]...)
  role       = aws_iam_role.this[each.value.role].name
  policy_arn = each.value.arn
}

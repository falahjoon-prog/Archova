# Nova on Linode (X25): the app servers call Bedrock and Textract in Sydney with short-lived credentials from IAM
# Roles Anywhere. Each server holds a client certificate from Archova's offline CA; AWS checks it against this
# trust anchor and hands out one-hour sessions for the role below. No long-lived AWS keys on the servers.

resource "aws_rolesanywhere_trust_anchor" "linode" {
  name    = "archova-linode-servers"
  enabled = true
  source {
    source_type = "CERTIFICATE_BUNDLE"
    source_data {
      x509_certificate_data = var.roles_anywhere_ca_pem
    }
  }
}

resource "aws_iam_role" "linode_app" {
  name                 = "archova-linode-app"
  max_session_duration = 3600
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "rolesanywhere.amazonaws.com" }
      Action    = ["sts:AssumeRole", "sts:TagSession", "sts:SetSourceIdentity"]
      Condition = {
        ArnEquals    = { "aws:SourceArn" = aws_rolesanywhere_trust_anchor.linode.arn }
        StringEquals = { "aws:PrincipalTag/x509Subject/OU" = "archova-linode-app" }
      }
    }]
  })
}

data "aws_iam_policy_document" "linode_app" {
  # X25: Australian models and the AU inference profile only, as on AWS (cells/cell/iam.tf).
  statement {
    sid     = "BedrockInAustralia"
    actions = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:Converse", "bedrock:ConverseStream", "bedrock:CountTokens"]
    resources = [
      "arn:aws:bedrock:ap-southeast-2::foundation-model/*",
      "arn:aws:bedrock:ap-southeast-4::foundation-model/*",
      "arn:aws:bedrock:ap-southeast-2:${var.aws_account_id}:inference-profile/au.*",
      "arn:aws:bedrock:ap-southeast-2:${var.aws_account_id}:application-inference-profile/*",
    ]
  }

  statement {
    sid       = "TextractInSydney"
    actions   = ["textract:DetectDocumentText"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = ["ap-southeast-2"]
    }
  }

  statement {
    sid       = "EmailFromArchova"
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = ["arn:aws:ses:ap-southeast-2:${var.aws_account_id}:identity/${var.domain}"]
  }
}

resource "aws_iam_role_policy" "linode_app" {
  name   = "nova-and-email"
  role   = aws_iam_role.linode_app.id
  policy = data.aws_iam_policy_document.linode_app.json
}

resource "aws_rolesanywhere_profile" "linode_app" {
  name             = "archova-linode-app"
  enabled          = true
  role_arns        = [aws_iam_role.linode_app.arn]
  duration_seconds = 3600
}

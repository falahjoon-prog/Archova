# Organisation guardrails (infrastructure/01 §2). Sam owns the security controls; this file is the mechanics.

locals {
  allowed_regions = ["ap-southeast-2", "ap-southeast-4"]

  # Global services whose control plane is in us-east-1. No customer data is stored by any of them.
  global_actions = [
    "a4b:*", "account:*", "acm:*", "aws-marketplace:*", "aws-portal:*", "billing:*", "budgets:*", "ce:*",
    "chatbot:*", "cloudfront:*", "cur:*", "health:*", "iam:*", "invoicing:*", "organizations:*",
    "payments:*", "pricing:*", "route53:*", "route53domains:*", "route53-recovery-*", "shield:*", "sso:*",
    "sso-directory:*", "identitystore:*", "sts:*", "support:*", "tax:*", "trustedadvisor:*", "waf:*",
    "waf-regional:*", "wafv2:*", "controltower:*", "config:*", "cloudtrail:*", "securityhub:*", "guardduty:*",
    "access-analyzer:*", "ecr-public:*", "s3:GetBucketLocation", "s3:ListAllMyBuckets", "notifications:*",
    "freetier:*", "artifact:*", "servicequotas:*",
  ]

  bedrock_au_resources = [
    "arn:aws:bedrock:ap-southeast-2::foundation-model/*",
    "arn:aws:bedrock:ap-southeast-4::foundation-model/*",
    "arn:aws:bedrock:ap-southeast-2:*:inference-profile/au.*",
    "arn:aws:bedrock:ap-southeast-2:*:application-inference-profile/*",
    "arn:aws:bedrock:ap-southeast-2:*:guardrail/*",
  ]

  scps = {
    "deny-other-regions" = {
      description = "Customer data stays in Sydney and Melbourne; only global control planes elsewhere."
      targets     = [var.workloads_ou_id, var.infrastructure_ou_id, var.security_ou_id]
      policy = {
        Version = "2012-10-17"
        Statement = [{
          Sid       = "DenyOutsideAustralia"
          Effect    = "Deny"
          NotAction = local.global_actions
          Resource  = "*"
          Condition = {
            StringNotEquals = { "aws:RequestedRegion" = local.allowed_regions }
            ArnNotLike      = { "aws:PrincipalArn" = ["arn:aws:iam::*:role/AWSControlTowerExecution"] }
          }
        }]
      }
    }

    "ai-in-australia-only" = {
      description = "X25: Bedrock models and inference profiles in Australia only, whoever calls."
      targets     = [var.workloads_ou_id, var.infrastructure_ou_id]
      policy = {
        Version = "2012-10-17"
        Statement = [
          {
            Sid         = "DenyBedrockOutsideAustralia"
            Effect      = "Deny"
            Action      = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:Converse", "bedrock:ConverseStream", "bedrock:StartAsyncInvoke", "bedrock:CreateModelInvocationJob"]
            NotResource = local.bedrock_au_resources
          },
        ]
      }
    }

    "protect-security-services" = {
      description = "Nobody disables CloudTrail, GuardDuty, Config or Security Hub, or deletes the log archive."
      targets     = [var.workloads_ou_id, var.infrastructure_ou_id, var.security_ou_id]
      policy = {
        Version = "2012-10-17"
        Statement = concat(
          [{
            Sid    = "DenyTamperingWithSecurityServices"
            Effect = "Deny"
            Action = [
              "cloudtrail:DeleteTrail", "cloudtrail:StopLogging", "cloudtrail:UpdateTrail", "cloudtrail:PutEventSelectors",
              "guardduty:DeleteDetector", "guardduty:DisassociateFromMasterAccount", "guardduty:DisassociateFromAdministratorAccount",
              "guardduty:UpdateDetector", "guardduty:DeleteMembers", "guardduty:StopMonitoringMembers",
              "config:DeleteConfigurationRecorder", "config:DeleteDeliveryChannel", "config:StopConfigurationRecorder",
              "securityhub:DisableSecurityHub", "securityhub:DeleteMembers", "securityhub:DisassociateFromMasterAccount",
              "access-analyzer:DeleteAnalyzer",
            ]
            Resource  = "*"
            Condition = { ArnNotLike = { "aws:PrincipalArn" = ["arn:aws:iam::*:role/AWSControlTowerExecution"] } }
          }],
          length(var.log_archive_bucket_arns) == 0 ? [] : [{
            Sid      = "DenyDeletingLogArchive"
            Effect   = "Deny"
            Action   = ["s3:DeleteBucket", "s3:DeleteObject", "s3:DeleteObjectVersion", "s3:PutLifecycleConfiguration", "s3:PutBucketPolicy"]
            Resource = concat(var.log_archive_bucket_arns, [for b in var.log_archive_bucket_arns : "${b}/*"])
          }],
        )
      }
    }

    "deny-root-and-iam-users" = {
      description = "No root use in member accounts; no IAM users or access keys (SSO only, break-glass excepted)."
      targets     = [var.workloads_ou_id, var.infrastructure_ou_id, var.security_ou_id]
      policy = {
        Version = "2012-10-17"
        Statement = [
          {
            Sid       = "DenyRoot"
            Effect    = "Deny"
            Action    = "*"
            Resource  = "*"
            Condition = { ArnLike = { "aws:PrincipalArn" = ["arn:aws:iam::*:root"] } }
          },
          {
            Sid       = "DenyIamUsersAndKeys"
            Effect    = "Deny"
            Action    = ["iam:CreateUser", "iam:CreateAccessKey", "iam:CreateLoginProfile"]
            Resource  = "*"
            Condition = { ArnNotLike = { "aws:PrincipalArn" = [var.break_glass_role_arn_pattern, "arn:aws:iam::*:role/AWSControlTowerExecution"] } }
          },
        ]
      }
    }

    "baseline-encryption" = {
      description = "IMDSv2 only; no unencrypted EBS volumes or RDS storage; account-level S3 Block Public Access stays on."
      targets     = [var.workloads_ou_id, var.infrastructure_ou_id]
      policy = {
        Version = "2012-10-17"
        Statement = [
          {
            Sid       = "RequireImdsV2"
            Effect    = "Deny"
            Action    = "ec2:RunInstances"
            Resource  = "arn:aws:ec2:*:*:instance/*"
            Condition = { StringNotEquals = { "ec2:MetadataHttpTokens" = "required" } }
          },
          {
            Sid       = "DenyUnencryptedVolumes"
            Effect    = "Deny"
            Action    = "ec2:CreateVolume"
            Resource  = "*"
            Condition = { Bool = { "ec2:Encrypted" = "false" } }
          },
          {
            Sid       = "DenyUnencryptedDatabases"
            Effect    = "Deny"
            Action    = ["rds:CreateDBCluster", "rds:CreateDBInstance"]
            Resource  = "*"
            Condition = { Bool = { "rds:StorageEncrypted" = "false" } }
          },
          {
            Sid      = "KeepS3PublicAccessBlock"
            Effect   = "Deny"
            Action   = ["s3:PutAccountPublicAccessBlock"]
            Resource = "*"
          },
        ]
      }
    }
  }

  attachments = merge([
    for name, scp in local.scps : { for t in scp.targets : "${name}|${t}" => { policy = name, target = t } }
  ]...)
}

resource "aws_organizations_policy" "scp" {
  for_each    = local.scps
  name        = "archova-${each.key}"
  description = each.value.description
  type        = "SERVICE_CONTROL_POLICY"
  content     = jsonencode(each.value.policy)
}

resource "aws_organizations_policy_attachment" "scp" {
  for_each  = local.attachments
  policy_id = aws_organizations_policy.scp[each.value.policy].id
  target_id = each.value.target
}

# Every resource carries env, service, cell, owner and cost-centre (infrastructure/01 §2, §8).
resource "aws_organizations_policy" "tags" {
  name        = "archova-required-tags"
  description = "Archova tag keys and their capitalisation"
  type        = "TAG_POLICY"
  content = jsonencode({
    tags = {
      for k in ["env", "service", "cell", "owner", "cost-centre"] : k => {
        tag_key = { "@@assign" = k }
      }
    }
  })
}

resource "aws_organizations_policy_attachment" "tags" {
  for_each  = toset([var.workloads_ou_id, var.infrastructure_ou_id])
  policy_id = aws_organizations_policy.tags.id
  target_id = each.value
}

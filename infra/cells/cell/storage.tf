# S3 buckets (infrastructure/01 §6, README "What the application needs"). Names add the account's last six
# digits because bucket names are global: archova-<env>-<cell>-<purpose>-<acct6>.

# Logs for the other buckets and the ALB. ALB access logs only support SSE-S3.
module "access_logs" {
  source                             = "../../modules/s3-bucket"
  name                               = "${local.name}-access-logs-${local.acct6}"
  noncurrent_version_expiration_days = 30
  expiration_days                    = var.log_retention_days
  force_destroy                      = var.force_destroy_buckets
  policy_statements                  = [data.aws_iam_policy_document.access_logs.json]
  tags                               = local.tags
}

data "aws_iam_policy_document" "access_logs" {
  statement {
    sid       = "S3ServerAccessLogs"
    actions   = ["s3:PutObject"]
    resources = ["arn:aws:s3:::${local.name}-access-logs-${local.acct6}/s3/*"]
    principals {
      type        = "Service"
      identifiers = ["logging.s3.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account]
    }
  }

  statement {
    sid       = "AlbAccessLogs"
    actions   = ["s3:PutObject"]
    resources = ["arn:aws:s3:::${local.name}-access-logs-${local.acct6}/alb/AWSLogs/${local.account}/*"]
    principals {
      type        = "Service"
      identifiers = ["logdelivery.elasticloadbalancing.amazonaws.com"]
    }
  }
}

# Uploads land in quarantine/{uploadId} through a presigned PUT, are scanned, then copied to orgs/{orgId}/...
# (X22). Quarantine objects that are never completed expire.
module "files" {
  source                             = "../../modules/s3-bucket"
  name                               = "${local.name}-files-${local.acct6}"
  kms_key_arn                        = module.kms_files.arn
  noncurrent_version_expiration_days = 90
  object_lock_enabled                = true # legal holds only, no default retention (Sam; security-licensing/07 §6)
  intelligent_tiering_after_days     = 30
  expire_prefixes                    = { "quarantine/" = 2, "threats/" = 30 } # threats/: malware.tf
  access_log_bucket                  = module.access_logs.id
  force_destroy                      = var.force_destroy_buckets
  policy_statements                  = concat([data.aws_iam_policy_document.files_scanned_only.json, data.aws_iam_policy_document.files_legal_hold_only.json], local.files_cdn ? [data.aws_iam_policy_document.files_cdn_read[0].json] : [])
  cors_rules = [{
    allowed_methods = ["PUT"]
    allowed_origins = ["https://${var.app_host}"]
    allowed_headers = ["content-type", "x-amz-checksum-sha256"]
    expose_headers  = ["etag"]
    }, {
    # The drawing and document viewers load PDFs with pdf.js from the presigned download URL, in byte ranges.
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["https://${var.app_host}"]
    allowed_headers = ["range"]
    expose_headers  = ["accept-ranges", "content-length", "content-range", "etag"]
  }]
  tags = merge(local.tags, { service = "files" })
}

module "exports" {
  source                             = "../../modules/s3-bucket"
  name                               = "${local.name}-exports-${local.acct6}"
  kms_key_arn                        = module.kms_files.arn
  expiration_days                    = 30
  noncurrent_version_expiration_days = 1
  expire_prefixes                    = { "exports/" = 8 } # one-click full data export (Sam): gone after 8 days, earlier than the bucket's 30
  access_log_bucket                  = module.access_logs.id
  force_destroy                      = var.force_destroy_buckets
  tags                               = merge(local.tags, { service = "files" })
}

# /_next/static assets, served only through CloudFront (origin access control). Public build output, so SSE-S3.
module "static_web" {
  source                             = "../../modules/s3-bucket"
  name                               = "${local.name}-static-web-${local.acct6}"
  noncurrent_version_expiration_days = 30
  access_log_bucket                  = module.access_logs.id
  force_destroy                      = var.force_destroy_buckets
  policy_statements                  = [data.aws_iam_policy_document.static_web.json]
  tags                               = merge(local.tags, { service = "web" })
}

data "aws_iam_policy_document" "static_web" {
  statement {
    sid       = "CloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::${local.name}-static-web-${local.acct6}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [module.edge.app_distribution_arn]
    }
  }
}

# Audit log exports and claims evidence: Object Lock in compliance mode, nobody (root included) can delete
# before retention ends (infrastructure/06 §2, Sam's security-licensing 07).
module "audit_archive" {
  source                             = "../../modules/s3-bucket"
  name                               = "${local.name}-audit-archive-${local.acct6}"
  kms_key_arn                        = module.kms_files.arn
  object_lock_retention_days         = var.audit_archive_retention_days
  noncurrent_version_expiration_days = null
  access_log_bucket                  = module.access_logs.id
  force_destroy                      = false
  tags                               = merge(local.tags, { service = "audit" })
}

# WAF logs for the CloudFront ACLs, kept in Sydney. The name must start with aws-waf-logs-.
module "waf_logs" {
  source                             = "../../modules/s3-bucket"
  name                               = "aws-waf-logs-${local.name}-${local.acct6}"
  noncurrent_version_expiration_days = 30
  expiration_days                    = var.log_retention_days
  force_destroy                      = var.force_destroy_buckets
  policy_statements                  = [data.aws_iam_policy_document.waf_logs.json]
  tags                               = local.tags
}

data "aws_iam_policy_document" "waf_logs" {
  statement {
    sid       = "WafLogDelivery"
    actions   = ["s3:PutObject"]
    resources = ["arn:aws:s3:::aws-waf-logs-${local.name}-${local.acct6}/AWSLogs/${local.account}/*"]
    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account]
    }
  }

  statement {
    sid       = "WafLogDeliveryAclCheck"
    actions   = ["s3:GetBucketAcl"]
    resources = ["arn:aws:s3:::aws-waf-logs-${local.name}-${local.acct6}"]
    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account]
    }
  }
}

# Write-once copies of the raw bytes of sealed payment-claim emails (SOPA delivery proof, compliance/07): Object Lock in
# compliance mode with a 10-year default retention in prod, so nobody (root included) can delete or shorten it. Separate
# from the audit archive because that one is retained for 7 years. Only the worker can write, and only PutObject.
module "claims_evidence" {
  source                             = "../../modules/s3-bucket"
  name                               = "${local.name}-claims-evidence-${local.acct6}"
  kms_key_arn                        = module.kms_files.arn
  object_lock_retention_days         = var.claims_evidence_retention_days
  noncurrent_version_expiration_days = null
  access_log_bucket                  = module.access_logs.id
  force_destroy                      = false
  tags                               = merge(local.tags, { service = "worker" })
}

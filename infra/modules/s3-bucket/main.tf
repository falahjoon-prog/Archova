# Private S3 bucket with the defaults every Archova bucket needs: Block Public Access, owner-enforced objects,
# SSE-KMS with bucket keys, versioning, TLS-only access and lifecycle rules (infrastructure/01 §6, 06 §2).

resource "aws_s3_bucket" "this" {
  bucket              = var.name
  force_destroy       = var.force_destroy
  object_lock_enabled = var.object_lock_enabled || var.object_lock_retention_days != null
  tags                = var.tags
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket                  = aws_s3_bucket.this.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = var.kms_key_arn == null ? "AES256" : "aws:kms"
      kms_master_key_id = var.kms_key_arn
    }
    bucket_key_enabled = var.kms_key_arn != null
  }
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id
  versioning_configuration {
    status = var.versioning || var.object_lock_enabled || var.object_lock_retention_days != null ? "Enabled" : "Suspended"
  }
}

resource "aws_s3_bucket_object_lock_configuration" "this" {
  count  = var.object_lock_retention_days == null ? 0 : 1
  bucket = aws_s3_bucket.this.id
  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = var.object_lock_retention_days
    }
  }
  depends_on = [aws_s3_bucket_versioning.this]
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    id     = "default"
    status = "Enabled"
    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }

    dynamic "noncurrent_version_expiration" {
      for_each = var.noncurrent_version_expiration_days == null ? [] : [1]
      content {
        noncurrent_days = var.noncurrent_version_expiration_days
      }
    }

    dynamic "expiration" {
      for_each = var.expiration_days == null ? [] : [1]
      content {
        days = var.expiration_days
      }
    }

    dynamic "transition" {
      for_each = var.intelligent_tiering_after_days == null ? [] : [1]
      content {
        days          = var.intelligent_tiering_after_days
        storage_class = "INTELLIGENT_TIERING"
      }
    }
  }

  dynamic "rule" {
    for_each = var.expire_prefixes
    content {
      id     = "expire-${trimsuffix(rule.key, "/")}"
      status = "Enabled"
      filter {
        prefix = rule.key
      }
      expiration {
        days = rule.value
      }
    }
  }

  depends_on = [aws_s3_bucket_versioning.this]
}

resource "aws_s3_bucket_cors_configuration" "this" {
  count  = length(var.cors_rules) > 0 ? 1 : 0
  bucket = aws_s3_bucket.this.id

  dynamic "cors_rule" {
    for_each = var.cors_rules
    content {
      allowed_methods = cors_rule.value.allowed_methods
      allowed_origins = cors_rule.value.allowed_origins
      allowed_headers = cors_rule.value.allowed_headers
      expose_headers  = cors_rule.value.expose_headers
      max_age_seconds = cors_rule.value.max_age_seconds
    }
  }
}

resource "aws_s3_bucket_logging" "this" {
  count         = var.access_log_bucket == null ? 0 : 1
  bucket        = aws_s3_bucket.this.id
  target_bucket = var.access_log_bucket
  target_prefix = "s3/${var.name}/"
}

data "aws_iam_policy_document" "tls_only" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.this.arn,
      "${aws_s3_bucket.this.arn}/*",
    ]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

data "aws_iam_policy_document" "combined" {
  source_policy_documents = concat([data.aws_iam_policy_document.tls_only.json], var.policy_statements)
}

resource "aws_s3_bucket_policy" "this" {
  bucket     = aws_s3_bucket.this.id
  policy     = data.aws_iam_policy_document.combined.json
  depends_on = [aws_s3_bucket_public_access_block.this]
}

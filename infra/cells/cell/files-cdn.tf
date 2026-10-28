# Drawing tiles CDN (mobile 03 §3.3, backend 06 §4). Phones fetch a sheet's {z}/{x}/{y}.webp tiles from CloudFront with
# one signed URL template per drawing revision. Nothing here exists unless var.files_cdn is set.
#
# What keeps it narrow (Sam):
#   - Only signed requests are served (trusted key group), and a signature covers one drawing's tile prefix.
#   - The bucket policy lets this distribution read orgs/*/projects/*/tiles/* only, so even a wrongly issued
#     signature cannot reach originals, exports or other objects. The tile prefix therefore has to contain /tiles/.
#   - Viewers are limited to Australia (var.files_cdn.allowed_countries) so tiles are cached at Australian edges only.
#     PriceClass_All is required for that, because Australian edge locations are not in the cheaper price classes.
#   - No access logging: a standard CloudFront log line contains the whole query string, which here is the signature.
#     If logging is ever needed, strip Policy, Signature and Key-Pair-Id before the logs are stored.
#   - The private key never enters Terraform state: the stack creates an empty secret and the key-rotation runbook
#     (like the JWT key) puts the key in it.

locals {
  files_cdn       = var.files_cdn != null
  files_cdn_paths = "orgs/*/projects/*/tiles/*"
}

resource "aws_cloudfront_public_key" "files" {
  count       = local.files_cdn ? 1 : 0
  name        = "${local.name}-files-tiles"
  comment     = "Verifies the api's signed drawing tile URLs (${local.name})"
  encoded_key = var.files_cdn.public_key_pem
}

resource "aws_cloudfront_key_group" "files" {
  count   = local.files_cdn ? 1 : 0
  name    = "${local.name}-files-tiles"
  comment = "Keys allowed to sign drawing tile URLs (${local.name})"
  items   = [aws_cloudfront_public_key.files[0].id]
}

# API_FILES_CDN_PRIVATE_KEY. Terraform creates the empty secret and the runbook puts the key in it, so a placeholder
# keeps the api starting until then (tile URLs just will not verify).
resource "aws_secretsmanager_secret" "files_cdn_key" {
  count                   = local.files_cdn ? 1 : 0
  name                    = "archova/${local.name}/api-files-cdn-private-key"
  description             = "API_FILES_CDN_PRIVATE_KEY for ${local.name}"
  kms_key_id              = module.kms_secrets.arn
  recovery_window_in_days = 7
  tags                    = merge(local.tags, { service = "api" })
}

resource "aws_secretsmanager_secret_version" "files_cdn_key" {
  count         = local.files_cdn ? 1 : 0
  secret_id     = aws_secretsmanager_secret.files_cdn_key[0].id
  secret_string = "unset"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_cloudfront_origin_access_control" "files" {
  count                             = local.files_cdn ? 1 : 0
  name                              = "${local.name}-files"
  description                       = "Drawing tiles in the files bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "files_optimized" {
  count = local.files_cdn ? 1 : 0
  name  = "Managed-CachingOptimized"
}

# The web drawing viewer fetches tiles from the app origin; phones are not browsers and ignore CORS.
resource "aws_cloudfront_response_headers_policy" "files" {
  count = local.files_cdn ? 1 : 0
  name  = "${local.name}-files-tiles"

  cors_config {
    access_control_allow_credentials = false
    access_control_allow_methods { items = ["GET", "HEAD"] }
    access_control_allow_origins { items = ["https://${var.app_host}"] }
    access_control_allow_headers { items = ["*"] }
    origin_override = true
  }

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
  }
}

resource "aws_cloudfront_distribution" "files" {
  #checkov:skip=CKV_AWS_86:Access logging is off on purpose, a standard log line carries the signed query string
  #checkov:skip=CKV_AWS_68:Signed tile requests only; a WAF in front adds cost without a threat it can stop here
  #checkov:skip=CKV_AWS_310:Origin failover needs a second origin; the files bucket is the only copy and S3 is multi-AZ
  #checkov:skip=CKV2_AWS_32:The response headers policy only sets CORS; the security headers apply to HTML, not tiles
  #checkov:skip=CKV2_AWS_47:No WAF on this distribution, see CKV_AWS_68
  #checkov:skip=CKV2_AWS_42:The default *.cloudfront.net certificate is used until the files custom domain exists
  #checkov:skip=CKV_AWS_174:The default CloudFront certificate cannot set a minimum TLS version; a custom domain does that later

  count           = local.files_cdn ? 1 : 0
  enabled         = true
  is_ipv6_enabled = true
  http_version    = "http2and3"
  comment         = "Drawing tiles (${local.name})"
  price_class     = "PriceClass_All"

  origin {
    origin_id                = "files"
    domain_name              = module.files.regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.files[0].id

    # A regional cache in Sydney in front of the bucket, so a miss at an Australian edge is filled from Sydney.
    origin_shield {
      enabled              = true
      origin_shield_region = local.region
    }
  }

  default_cache_behavior {
    target_origin_id           = "files"
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = false # webp is already compressed
    cache_policy_id            = data.aws_cloudfront_cache_policy.files_optimized[0].id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.files[0].id
    trusted_key_groups         = [aws_cloudfront_key_group.files[0].id]
  }

  restrictions {
    geo_restriction {
      restriction_type = "whitelist"
      locations        = var.files_cdn.allowed_countries
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = merge(local.tags, { service = "files" })
}

# Only this distribution may read, and only tiles. Everything else in the bucket is unreachable through the CDN.
data "aws_iam_policy_document" "files_cdn_read" {
  count = local.files_cdn ? 1 : 0

  statement {
    sid       = "CloudFrontReadsTilesOnly"
    actions   = ["s3:GetObject"]
    resources = ["${module.files.arn}/${local.files_cdn_paths}"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.files[0].arn]
    }
  }
}

output "files_cdn" {
  description = "Drawing tiles CDN: the distribution's domain and the secret to put the signing key in. Null when there is none."
  value = local.files_cdn ? {
    domain         = aws_cloudfront_distribution.files[0].domain_name
    key_pair_id    = aws_cloudfront_public_key.files[0].id
    private_key_id = aws_secretsmanager_secret.files_cdn_key[0].name
  } : null
}

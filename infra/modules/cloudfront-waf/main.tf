# CloudFront for app.<domain> and api.<domain> per ADR-0004 (infrastructure/01 §4):
#
#   app.<domain>  /_next/static/*  -> S3 (cached)
#                 /v1/*, /.well-known/*, /realtime -> ALB, never cached, cookies and Origin forwarded
#                 default -> ALB (web, SSR)
#   api.<domain>  everything -> ALB, Authorization forwarded, all cookies stripped
#
# CloudFront forwards the viewer Host so the ALB's host rules and the api's API_APP_ORIGINS/API_PUBLIC_HOSTS
# checks see app.<domain> or api.<domain>.

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewer"
}

locals {
  alb_origin_id    = "alb"
  static_origin_id = "static-web"
  with_aliases     = var.certificate_arn != null
}

# The api distribution must forward Authorization, which CloudFront only does through the cache policy. TTLs
# of 0/0/1 with the API's Cache-Control: no-store mean nothing is cached.
resource "aws_cloudfront_cache_policy" "api" {
  name        = "${var.name}-api-bearer"
  min_ttl     = 0
  default_ttl = 0
  max_ttl     = 1

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["Authorization"]
      }
    }

    cookies_config {
      cookie_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "all"
    }
  }
}

# Everything the api needs except cookies: a browser session can never authenticate on api.<domain>.
resource "aws_cloudfront_origin_request_policy" "api" {
  name = "${var.name}-api-no-cookies"

  headers_config {
    header_behavior = "allViewerAndWhitelistCloudFront"
    headers {
      items = ["CloudFront-Viewer-Country"]
    }
  }

  cookies_config {
    cookie_behavior = "none"
  }

  query_strings_config {
    query_string_behavior = "all"
  }
}

resource "aws_cloudfront_response_headers_policy" "security" {
  name = "${var.name}-security-headers"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = false
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = false
    }
  }
}

resource "aws_cloudfront_origin_access_control" "static" {
  name                              = "${var.name}-static-web"
  description                       = "Static web assets"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "app" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${var.name} app (${var.app_host})"
  aliases         = local.with_aliases ? [var.app_host] : []
  price_class     = var.price_class
  http_version    = "http2and3"
  web_acl_id      = aws_wafv2_web_acl.this["app"].arn

  origin {
    origin_id   = local.alb_origin_id
    domain_name = var.alb_origin_host

    custom_header {
      name  = var.origin_header_name
      value = var.origin_header_value
    }

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 60
    }
  }

  origin {
    origin_id                = local.static_origin_id
    domain_name              = var.static_bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.static.id
  }

  ordered_cache_behavior {
    path_pattern               = "/_next/static/*"
    target_origin_id           = local.static_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
  }

  dynamic "ordered_cache_behavior" {
    for_each = ["/v1/*", "/.well-known/*", "/realtime"]
    content {
      path_pattern               = ordered_cache_behavior.value
      target_origin_id           = local.alb_origin_id
      viewer_protocol_policy     = "https-only"
      allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods             = ["GET", "HEAD"]
      compress                   = true
      cache_policy_id            = data.aws_cloudfront_cache_policy.disabled.id
      origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer.id
      response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
    }
  }

  default_cache_behavior {
    target_origin_id           = local.alb_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.certificate_arn == null
    acm_certificate_arn            = var.certificate_arn
    ssl_support_method             = var.certificate_arn == null ? null : "sni-only"
    minimum_protocol_version       = var.certificate_arn == null ? "TLSv1" : "TLSv1.2_2021"
  }

  tags = var.tags
}

resource "aws_cloudfront_distribution" "api" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${var.name} api (${var.api_host})"
  aliases         = local.with_aliases ? [var.api_host] : []
  price_class     = var.price_class
  http_version    = "http2and3"
  web_acl_id      = aws_wafv2_web_acl.this["api"].arn

  origin {
    origin_id   = local.alb_origin_id
    domain_name = var.alb_origin_host

    custom_header {
      name  = var.origin_header_name
      value = var.origin_header_value
    }

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 60
    }
  }

  default_cache_behavior {
    target_origin_id           = local.alb_origin_id
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.api.id
    origin_request_policy_id   = aws_cloudfront_origin_request_policy.api.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.certificate_arn == null
    acm_certificate_arn            = var.certificate_arn
    ssl_support_method             = var.certificate_arn == null ? null : "sni-only"
    minimum_protocol_version       = var.certificate_arn == null ? "TLSv1" : "TLSv1.2_2021"
  }

  tags = var.tags
}

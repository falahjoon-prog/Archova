# Separate web ACLs for app.<domain> and api.<domain> (infrastructure/01 §4). CloudFront-scoped ACLs live in
# us-east-1 (control plane only); their logs go to a Sydney bucket.

locals {
  managed_groups = [
    { name = "AWSManagedRulesAmazonIpReputationList", priority = 10 },
    { name = "AWSManagedRulesCommonRuleSet", priority = 20 },
    { name = "AWSManagedRulesKnownBadInputsRuleSet", priority = 30 },
  ]

  acls = {
    app = {
      ip_limit         = var.rate_limit_per_ip
      credential_key   = "cookie"
      credential_name  = "__Host-sid"
      credential_limit = var.rate_limit_per_credential
    }
    api = {
      ip_limit         = var.api_rate_limit_per_ip
      credential_key   = "header"
      credential_name  = "authorization"
      credential_limit = var.rate_limit_per_credential
    }
  }
}

resource "aws_wafv2_web_acl" "this" {
  for_each = local.acls
  provider = aws.us_east_1
  name     = "${var.name}-${each.key}"
  scope    = "CLOUDFRONT"

  default_action {
    allow {}
  }

  # The backoffice API is reachable only from console.<domain> (X56, ADR-0008).
  rule {
    name     = "block-internal-api"
    priority = 1

    action {
      block {}
    }

    statement {
      byte_match_statement {
        search_string         = "/internal"
        positional_constraint = "STARTS_WITH"
        field_to_match {
          uri_path {}
        }
        text_transformation {
          priority = 0
          type     = "URL_DECODE"
        }
        text_transformation {
          priority = 1
          type     = "LOWERCASE"
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-${each.key}-internal"
      sampled_requests_enabled   = true
    }
  }

  dynamic "rule" {
    for_each = local.managed_groups
    content {
      name     = rule.value.name
      priority = rule.value.priority

      override_action {
        dynamic "none" {
          for_each = var.waf_block ? [1] : []
          content {}
        }
        dynamic "count" {
          for_each = var.waf_block ? [] : [1]
          content {}
        }
      }

      statement {
        managed_rule_group_statement {
          vendor_name = "AWS"
          name        = rule.value.name

          # API and upload-completion bodies are larger than the common rule set's 8 KB limit; the api enforces
          # its own body limits.
          dynamic "rule_action_override" {
            for_each = rule.value.name == "AWSManagedRulesCommonRuleSet" ? ["SizeRestrictions_BODY"] : []
            content {
              name = rule_action_override.value
              action_to_use {
                count {}
              }
            }
          }
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "${var.name}-${each.key}-${rule.value.name}"
        sampled_requests_enabled   = true
      }
    }
  }

  rule {
    name     = "rate-per-ip"
    priority = 40

    action {
      dynamic "block" {
        for_each = var.waf_block ? [1] : []
        content {}
      }
      dynamic "count" {
        for_each = var.waf_block ? [] : [1]
        content {}
      }
    }

    statement {
      rate_based_statement {
        limit              = each.value.ip_limit
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-${each.key}-rate-ip"
      sampled_requests_enabled   = true
    }
  }

  # Per session (app) or per bearer token / API key (api), so one noisy account behind a shared site IP is limited
  # without blocking the whole site office.
  rule {
    name     = "rate-per-credential"
    priority = 41

    action {
      dynamic "block" {
        for_each = var.waf_block ? [1] : []
        content {}
      }
      dynamic "count" {
        for_each = var.waf_block ? [] : [1]
        content {}
      }
    }

    statement {
      rate_based_statement {
        limit              = each.value.credential_limit
        aggregate_key_type = "CUSTOM_KEYS"

        custom_key {
          dynamic "cookie" {
            for_each = each.value.credential_key == "cookie" ? [1] : []
            content {
              name = each.value.credential_name
              text_transformation {
                priority = 0
                type     = "NONE"
              }
            }
          }
          dynamic "header" {
            for_each = each.value.credential_key == "header" ? [1] : []
            content {
              name = each.value.credential_name
              text_transformation {
                priority = 0
                type     = "NONE"
              }
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-${each.key}-rate-credential"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name}-${each.key}"
    sampled_requests_enabled   = true
  }

  tags = var.tags
}

resource "aws_wafv2_web_acl_logging_configuration" "this" {
  for_each                = aws_wafv2_web_acl.this
  provider                = aws.us_east_1
  resource_arn            = each.value.arn
  log_destination_configs = [var.waf_log_bucket_arn]

  redacted_fields {
    single_header {
      name = "authorization"
    }
  }

  redacted_fields {
    single_header {
      name = "cookie"
    }
  }
}

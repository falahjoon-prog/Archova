# Route 53, certificates and the Application Load Balancer (infrastructure/01 §4). The ALB accepts traffic only
# from CloudFront (managed prefix list) carrying the secret origin header, so nobody can bypass the WAF.

locals {
  alb_origin_host    = "origin.${var.app_host}"
  origin_header_name = "X-Archova-Origin-Verify"
}

resource "random_password" "origin_header" {
  length  = 48
  special = false
}

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

# --- Certificates --------------------------------------------------------------------------------------------

resource "aws_acm_certificate" "alb" {
  domain_name               = local.alb_origin_host
  subject_alternative_names = [var.app_host, var.api_host]
  validation_method         = "DNS"
  tags                      = local.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate" "cloudfront" {
  provider                  = aws.us_east_1
  domain_name               = var.app_host
  subject_alternative_names = [var.api_host]
  validation_method         = "DNS"
  tags                      = local.tags

  lifecycle {
    create_before_destroy = true
  }
}

locals {
  # Both certificates ask for the same CNAMEs for the shared names; one record per name.
  validation_records = {
    for o in concat(tolist(aws_acm_certificate.alb.domain_validation_options), tolist(aws_acm_certificate.cloudfront.domain_validation_options)) :
    o.domain_name => o...
  }
}

resource "aws_route53_record" "validation" {
  provider        = aws.dns
  for_each        = local.validation_records
  zone_id         = var.dns_zone_id
  name            = each.value[0].resource_record_name
  type            = each.value[0].resource_record_type
  records         = [each.value[0].resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "alb" {
  certificate_arn         = aws_acm_certificate.alb.arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]
}

resource "aws_acm_certificate_validation" "cloudfront" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.cloudfront.arn
  validation_record_fqdns = [for k, r in aws_route53_record.validation : r.fqdn if k != local.alb_origin_host]
}

# --- Load balancer -------------------------------------------------------------------------------------------

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "ALB: HTTPS from CloudFront only"
  vpc_id      = module.network.vpc_id
  tags        = merge(local.tags, { Name = "${local.name}-alb" })
}

resource "aws_vpc_security_group_ingress_rule" "alb_from_cloudfront" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS from CloudFront origin-facing addresses"
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_vpc" {
  security_group_id = aws_security_group.alb.id
  description       = "To service tasks"
  cidr_ipv4         = var.vpc_cidr
  ip_protocol       = "tcp"
  from_port         = 1024
  to_port           = 65535
}

resource "aws_lb" "this" {
  name                       = local.name
  load_balancer_type         = "application"
  internal                   = false
  security_groups            = [aws_security_group.alb.id]
  subnets                    = module.network.public_subnet_ids
  drop_invalid_header_fields = true
  desync_mitigation_mode     = "strictest"
  enable_deletion_protection = var.deletion_protection
  idle_timeout               = 300 # realtime sockets ping well inside this
  ip_address_type            = "ipv4"

  access_logs {
    bucket  = module.access_logs.id
    prefix  = "alb"
    enabled = true
  }

  tags = local.tags
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.alb.certificate_arn

  # Anything that doesn't match a service rule (wrong host, missing origin header, /internal/*) gets 403.
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }

  tags = local.tags
}

# --- DNS -----------------------------------------------------------------------------------------------------

resource "aws_route53_record" "origin" {
  provider = aws.dns
  zone_id  = var.dns_zone_id
  name     = local.alb_origin_host
  type     = "A"

  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "app" {
  provider = aws.dns
  for_each = toset(["A", "AAAA"])
  zone_id  = var.dns_zone_id
  name     = var.app_host
  type     = each.key

  alias {
    name                   = module.edge.app_distribution_domain_name
    zone_id                = module.edge.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "api" {
  provider = aws.dns
  for_each = toset(["A", "AAAA"])
  zone_id  = var.dns_zone_id
  name     = var.api_host
  type     = each.key

  alias {
    name                   = module.edge.api_distribution_domain_name
    zone_id                = module.edge.hosted_zone_id
    evaluate_target_health = false
  }
}

# Layer 3 of the AI egress controls (infrastructure/01 §3.1): Route 53 Resolver DNS Firewall blocks resolution of
# AI vendor domains that are not on the allow-list, for every subnet, and query logs are kept.

resource "aws_route53_resolver_firewall_domain_list" "allowed" {
  name    = "${var.name}-egress-allowed"
  domains = var.restricted_allowlist
  tags    = local.tags
}

resource "aws_route53_resolver_firewall_domain_list" "ai_denied" {
  name    = "${var.name}-ai-vendors-denied"
  domains = flatten([for d in var.ai_vendor_denylist : [d, "*.${d}"]])
  tags    = local.tags
}

resource "aws_route53_resolver_firewall_rule_group" "this" {
  name = "${var.name}-egress"
  tags = local.tags
}

# Approved hosts first, so an approved Azure resource in Australia resolves even though *.openai.azure.com is denied.
resource "aws_route53_resolver_firewall_rule" "allowed" {
  name                    = "allow-approved-hosts"
  action                  = "ALLOW"
  firewall_domain_list_id = aws_route53_resolver_firewall_domain_list.allowed.id
  firewall_rule_group_id  = aws_route53_resolver_firewall_rule_group.this.id
  priority                = 100
}

resource "aws_route53_resolver_firewall_rule" "ai_denied" {
  name                    = "block-ai-vendors"
  action                  = "BLOCK"
  block_response          = "NXDOMAIN"
  firewall_domain_list_id = aws_route53_resolver_firewall_domain_list.ai_denied.id
  firewall_rule_group_id  = aws_route53_resolver_firewall_rule_group.this.id
  priority                = 200
}

resource "aws_route53_resolver_firewall_rule_group_association" "this" {
  name                   = var.name
  firewall_rule_group_id = aws_route53_resolver_firewall_rule_group.this.id
  vpc_id                 = aws_vpc.this.id
  priority               = 200
  tags                   = local.tags
}

resource "aws_route53_resolver_firewall_config" "this" {
  resource_id        = aws_vpc.this.id
  firewall_fail_open = "DISABLED"
}

resource "aws_cloudwatch_log_group" "dns" {
  name              = "/archova/${var.name}/dns-queries"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.logs_kms_key_arn
  tags              = local.tags
}

resource "aws_route53_resolver_query_log_config" "this" {
  name            = var.name
  destination_arn = aws_cloudwatch_log_group.dns.arn
  tags            = local.tags
}

resource "aws_route53_resolver_query_log_config_association" "this" {
  resolver_query_log_config_id = aws_route53_resolver_query_log_config.this.id
  resource_id                  = aws_vpc.this.id
}

# AWS Network Firewall: the network half of the AI residency rule (X25, X28; infrastructure/01 §3.1).
#
# Restricted subnets (api, ai-worker): HTTPS to the exact hostnames in egress-allowlist.yaml, nothing else.
# Private subnets (web, workers): anything except the AI vendor deny-list, so they cannot be used as a side door.
#
# Strict rule order, default drop for established flows: a flow leaves only if a pass rule below matched it.

locals {
  # Suricata rule bodies. SIDs are stable per position: restricted allow-list 1xxxxx, deny-list 2xxxxx, others 9xxxxx.
  restricted_allow_rules = [
    for i, host in var.restricted_allowlist :
    "pass tls $RESTRICTED_NET any -> $EXTERNAL_NET 443 (tls.sni; content:\"${host}\"; startswith; nocase; endswith; flow:to_server, established; msg:\"restricted: allow-listed host ${host}\"; sid:${100001 + i}; rev:1;)"
  ]

  private_deny_rules = flatten([
    for i, domain in var.ai_vendor_denylist : [
      "drop tls $PRIVATE_NET any -> $EXTERNAL_NET any (tls.sni; dotprefix; content:\".${domain}\"; nocase; endswith; flow:to_server, established; msg:\"private: AI vendor ${domain} is not allowed\"; sid:${200001 + 2 * i}; rev:1;)",
      "drop http $PRIVATE_NET any -> $EXTERNAL_NET any (http.host; dotprefix; content:\".${domain}\"; nocase; endswith; flow:to_server, established; msg:\"private: AI vendor ${domain} is not allowed\"; sid:${200002 + 2 * i}; rev:1;)",
    ]
  ])

  suricata_rules = join("\n", concat(
    [
      "# Restricted subnets: TCP handshakes on 443 only, then the TLS server name must be on the allow-list.",
      "pass tcp $RESTRICTED_NET any <> $EXTERNAL_NET 443 (flow:not_established; msg:\"restricted: TCP handshake on 443\"; sid:900001; rev:1;)",
    ],
    local.restricted_allow_rules,
    [
      "alert tls $RESTRICTED_NET any -> $EXTERNAL_NET any (flow:to_server, established; msg:\"restricted: TLS host not on the allow-list\"; sid:900002; rev:1;)",
      "drop ip $RESTRICTED_NET any -> $EXTERNAL_NET any (msg:\"restricted: egress not on the allow-list\"; sid:900003; rev:1;)",
      "# Private subnets: everything except AI vendors.",
    ],
    local.private_deny_rules,
    [
      "pass ip $PRIVATE_NET any -> $EXTERNAL_NET any (msg:\"private: general egress\"; sid:900004; rev:1;)",
      "pass ip $EXTERNAL_NET any -> $PRIVATE_NET any (flow:to_client; msg:\"private: replies\"; sid:900005; rev:1;)",
    ],
  ))
}

resource "aws_networkfirewall_rule_group" "egress" {
  name     = "${var.name}-egress"
  type     = "STATEFUL"
  capacity = 100 + 2 * length(var.restricted_allowlist) + 4 * length(var.ai_vendor_denylist)

  rule_group {
    rule_variables {
      ip_sets {
        key = "RESTRICTED_NET"
        ip_set {
          definition = local.restricted_cidrs
        }
      }
      ip_sets {
        key = "PRIVATE_NET"
        ip_set {
          definition = local.private_cidrs
        }
      }
      ip_sets {
        key = "HOME_NET"
        ip_set {
          definition = [var.cidr_block]
        }
      }
    }

    rules_source {
      rules_string = local.suricata_rules
    }

    stateful_rule_options {
      rule_order = "STRICT_ORDER"
    }
  }

  encryption_configuration {
    type   = "CUSTOMER_KMS"
    key_id = var.logs_kms_key_arn
  }

  tags = local.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_networkfirewall_firewall_policy" "this" {
  name = "${var.name}-egress"

  firewall_policy {
    stateless_default_actions          = ["aws:forward_to_sfe"]
    stateless_fragment_default_actions = ["aws:forward_to_sfe"]

    stateful_engine_options {
      rule_order = "STRICT_ORDER"
    }

    # A flow that no pass rule matched is dropped and logged.
    stateful_default_actions = ["aws:drop_established", "aws:alert_established"]

    stateful_rule_group_reference {
      priority     = 100
      resource_arn = aws_networkfirewall_rule_group.egress.arn
    }
  }

  encryption_configuration {
    type   = "CUSTOMER_KMS"
    key_id = var.logs_kms_key_arn
  }

  tags = local.tags
}

resource "aws_networkfirewall_firewall" "this" {
  name                = var.name
  firewall_policy_arn = aws_networkfirewall_firewall_policy.this.arn
  vpc_id              = aws_vpc.this.id
  delete_protection   = var.deletion_protection

  dynamic "subnet_mapping" {
    for_each = slice(aws_subnet.firewall, 0, var.firewall_endpoint_count)
    content {
      subnet_id = subnet_mapping.value.id
    }
  }

  encryption_configuration {
    type   = "CUSTOMER_KMS"
    key_id = var.logs_kms_key_arn
  }

  tags = local.tags
}

resource "aws_cloudwatch_log_group" "firewall_alert" {
  name              = "/archova/${var.name}/network-firewall/alert"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.logs_kms_key_arn
  tags              = local.tags
}

resource "aws_cloudwatch_log_group" "firewall_flow" {
  name              = "/archova/${var.name}/network-firewall/flow"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.logs_kms_key_arn
  tags              = local.tags
}

resource "aws_networkfirewall_logging_configuration" "this" {
  firewall_arn = aws_networkfirewall_firewall.this.arn

  logging_configuration {
    log_destination_config {
      log_type             = "ALERT"
      log_destination_type = "CloudWatchLogs"
      log_destination = {
        logGroup = aws_cloudwatch_log_group.firewall_alert.name
      }
    }

    log_destination_config {
      log_type             = "FLOW"
      log_destination_type = "CloudWatchLogs"
      log_destination = {
        logGroup = aws_cloudwatch_log_group.firewall_flow.name
      }
    }
  }
}

# Any drop from the restricted subnets means code tried to reach a host that is not approved. Pages on-call
# (via the observability module's alarm on this metric).
resource "aws_cloudwatch_log_metric_filter" "restricted_drops" {
  name           = "${var.name}-restricted-egress-blocked"
  log_group_name = aws_cloudwatch_log_group.firewall_alert.name
  pattern        = "{ $.event.alert.signature_id = 900002 || $.event.alert.signature_id = 900003 }"

  metric_transformation {
    namespace     = "Archova/Network"
    name          = "RestrictedEgressBlocked"
    value         = "1"
    default_value = "0"
  }
}

# prod, cell 1: customers. Two sizes, picked with var.size (infrastructure/09 §4):
#   lean (pilots, 2-3 builders): three AZs for subnets, but one NAT, one firewall endpoint and interface
#     endpoints in one AZ; one Aurora Serverless v2 writer with no reader or proxy; one Valkey node; two small
#     tasks per service. An AZ outage can take it down until the AZ recovers or we restore elsewhere.
#   full (from the first paying builder): a NAT and a firewall endpoint in each AZ, Aurora writer + reader,
#     split Valkey with replicas, three tasks per service.
# Both keep WAF blocking, the egress firewall, GuardDuty scanning, 35-day PITR and AWS Backup copies to the
# backup account in Sydney and Melbourne (infrastructure/02 §3, 06 §2). Going from lean to full is this one
# variable and an apply: no data moves.

# Published egress IPs (Leo L3): allocated once, never released, announced 30 days before any change. All three
# exist in both sizes so the published list never changes; lean uses the first one (two idle IPs, ~US$7/month).
resource "aws_eip" "egress" {
  count  = 3
  domain = "vpc"
  tags = {
    Name    = "archova-prod-c1-egress-${count.index + 1}"
    purpose = "published-egress-ip"
  }

  lifecycle {
    prevent_destroy = true
  }
}

module "cell" {
  source = "../../cells/cell"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
    aws.dns       = aws.dns # apex zone in shared-services
  }

  env         = "prod"
  cell        = "c1"
  app_host    = "app.${var.domain}"
  api_host    = "api.${var.domain}"
  dns_zone_id = var.dns_zone_id
  waf_block   = true

  vpc_cidr                    = "10.10.0.0/16"
  az_count                    = 3
  nat_gateway_count           = local.size.nat_gateways
  firewall_endpoint_count     = local.size.nat_gateways
  interface_endpoint_az_count = local.size.endpoint_azs
  nat_eip_allocation_ids      = slice(aws_eip.egress[*].id, 0, local.size.nat_gateways)
  egress_allowlist            = yamldecode(file("${path.module}/egress-allowlist.yaml"))

  aurora = local.size.aurora
  valkey = local.size.valkey

  audit_archive_retention_days = 2557 # 7 years (Sam, security-licensing 07 §5)

  backup = {
    daily_retention_days   = 35
    monthly_retention_days = 365
    yearly_retention_days  = 2555
    copy_to_vault_arns     = var.backup_vault_arns
  }

  images = {
    api       = "${var.image_registry}/archova/api:bootstrap"
    web       = "${var.image_registry}/archova/web:bootstrap"
    migrate   = "${var.image_registry}/archova/migrate:bootstrap"
    worker    = "${var.image_registry}/archova/worker:bootstrap"
    ai-worker = "${var.image_registry}/archova/ai-worker:bootstrap"
  }

  services = local.size.services

  # Bedrock AU inference profiles (Ari, 2 Oct 2026), as in the demo. Enable model access in this account first.
  ai_models = {
    fast     = "au.anthropic.claude-haiku-4-5-20251001-v1:0"
    standard = "au.anthropic.claude-sonnet-5"
    advanced = "au.anthropic.claude-opus-5-5"
  }

  deletion_protection = true
  ci                  = {}

  log_retention_days = 365
}

locals {
  sizes = {
    lean = {
      nat_gateways = 1
      endpoint_azs = 1
      aurora = {
        instance_class        = "db.serverless"
        instance_count        = 1
        serverless_min_acu    = 1 # never pauses
        serverless_max_acu    = 8
        io_optimized          = false
        backup_retention_days = 35
        enable_proxy          = false
      }
      valkey = {
        split           = false
        queue_node_type = "cache.t4g.small"
        replicas        = 0
      }
      # Pilot tier (infrastructure/04 §3): two tasks each, one per AZ, so a deploy or a task failure never
      # leaves the app with none.
      services = {
        api = { cpu = 512, memory = 1024, min = 2, max = 10, desired = 2 }
        web = { cpu = 512, memory = 1024, min = 2, max = 6, desired = 2 }
      }
    }

    full = {
      nat_gateways = 3
      endpoint_azs = null # every AZ
      aurora = {
        instance_class        = "db.r7g.large"
        instance_count        = 2
        io_optimized          = true
        backup_retention_days = 35
      }
      # cache.r7g.large from ~1k users (infrastructure/01 §6).
      valkey = {
        split           = true
        queue_node_type = "cache.t4g.medium"
        cache_node_type = "cache.t4g.medium"
        replicas        = 1
      }
      # requests_per_target is set after the first load test (~120 req/s).
      services = {
        api = {
          cpu              = 1024, memory = 2048, min = 3, max = 60, desired = 3
          scheduled_floors = local.morning_ramp
        }
        web = {
          cpu              = 1024, memory = 2048, min = 3, max = 30, desired = 3
          scheduled_floors = local.morning_ramp
        }
      }
    }
  }
  size = local.sizes[var.size]

  # The morning ramp never waits for scaling: the floor goes up at 6am weekdays and back down after 9am
  # (infrastructure/04 §4). Floors here equal the full minimum; raise them as traffic grows.
  morning_ramp = [
    { name = "weekday-ramp", schedule = "cron(0 6 ? * MON-FRI *)", min = 3, max = 60 },
  ]
}

output "cell" {
  value = module.cell
}

output "published_egress_ips" {
  value = aws_eip.egress[*].public_ip
}

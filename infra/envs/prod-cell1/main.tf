# prod, cell 1: customers. Three AZs with a NAT and a firewall endpoint in each, Aurora writer + reader, split
# Valkey, on-demand Fargate, WAF blocking, 35-day PITR plus AWS Backup copies to the backup account
# (infrastructure/02 §3, 06 §2).

# Published egress IPs (Leo L3): allocated once, never released, announced 30 days before any change.
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

  vpc_cidr                = "10.10.0.0/16"
  az_count                = 3
  nat_gateway_count       = 3
  firewall_endpoint_count = 3
  nat_eip_allocation_ids  = aws_eip.egress[*].id
  egress_allowlist        = yamldecode(file("${path.module}/egress-allowlist.yaml"))

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

  audit_archive_retention_days = 2557 # 7 years (Sam, security-licensing 07 §5)

  backup = {
    daily_retention_days   = 35
    monthly_retention_days = 365
    yearly_retention_days  = 2555
    copy_to_vault_arns     = var.backup_vault_arns
  }

  images = {
    api     = "${var.image_registry}/archova/api:bootstrap"
    web     = "${var.image_registry}/archova/web:bootstrap"
    migrate = "${var.image_registry}/archova/migrate:bootstrap"
  }

  # Pilot tier (infrastructure/04 §3). requests_per_target is set after the first load test (~120 req/s).
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

  deletion_protection = true
  ci                  = {}

  log_retention_days = 365
}

locals {
  # The morning ramp never waits for scaling: the floor goes up at 6am weekdays and back down after 9am
  # (infrastructure/04 §4). Floors here equal the pilot minimum; raise them as traffic grows.
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

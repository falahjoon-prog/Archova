# dev: integration of main, always the latest code. Two AZs, one NAT and one firewall endpoint, Aurora Serverless
# v2, one Valkey node, Fargate Spot, scaled to zero out of hours (infrastructure/02 §3).

module "cell" {
  source = "../../cells/cell"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
    aws.dns       = aws # dev.<domain> is delegated to this account
  }

  env         = "dev"
  cell        = "c1"
  app_host    = "app.dev.${var.domain}"
  api_host    = "api.dev.${var.domain}"
  dns_zone_id = var.dns_zone_id
  waf_block   = false

  vpc_cidr                = "10.30.0.0/16"
  az_count                = 2
  nat_gateway_count       = 1
  firewall_endpoint_count = 1
  egress_allowlist        = yamldecode(file("${path.module}/egress-allowlist.yaml"))

  aurora = {
    instance_class        = "db.serverless"
    instance_count        = 1
    serverless_min_acu    = 0.5
    serverless_max_acu    = 4
    io_optimized          = false
    backup_retention_days = 1
    enable_proxy          = false
  }

  valkey = {
    split               = false
    queue_node_type     = "cache.t4g.small"
    replicas            = 0
    queue_snapshot_days = 0
  }

  audit_archive_retention_days = 1
  backup                       = null

  images = {
    api     = "${var.image_registry}/archova/api:bootstrap"
    web     = "${var.image_registry}/archova/web:bootstrap"
    migrate = "${var.image_registry}/archova/migrate:bootstrap"
    worker  = "${var.image_registry}/archova/worker:bootstrap"
  }

  services = {
    api = {
      cpu              = 1024, memory = 2048, min = 1, max = 2, desired = 1, spot = true
      scheduled_floors = local.office_hours
    }
    web = {
      cpu              = 1024, memory = 2048, min = 1, max = 2, desired = 1, spot = true
      scheduled_floors = local.office_hours
    }
  }

  enable_execute_command = true
  deletion_protection    = false
  force_destroy_buckets  = true
  ci                     = {}

  log_retention_days = 30
}

locals {
  # Weekdays 7am-7pm Sydney time; zero tasks at night and on weekends.
  office_hours = [
    { name = "weekday-start", schedule = "cron(0 7 ? * MON-FRI *)", min = 1, max = 2 },
    { name = "weekday-stop", schedule = "cron(0 19 ? * MON-FRI *)", min = 0, max = 0 },
  ]
}

output "cell" {
  value = module.cell
}

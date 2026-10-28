# staging: production rehearsal. Same topology as prod with smaller sizes, synthetic data only, never real
# customer data (infrastructure/02 §1, §3).

module "cell" {
  source = "../../cells/cell"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
    aws.dns       = aws # staging.<domain> is delegated to this account
  }

  env         = "staging"
  cell        = "c1"
  app_host    = "app.staging.${var.domain}"
  api_host    = "api.staging.${var.domain}"
  dns_zone_id = var.dns_zone_id
  waf_block   = true

  vpc_cidr                = "10.20.0.0/16"
  az_count                = 3
  nat_gateway_count       = 1
  firewall_endpoint_count = 3
  egress_allowlist        = yamldecode(file("${path.module}/egress-allowlist.yaml"))

  aurora = {
    instance_class        = "db.r7g.large"
    instance_count        = 2
    io_optimized          = true
    backup_retention_days = 7
  }

  valkey = {
    split           = true
    queue_node_type = "cache.t4g.medium"
    cache_node_type = "cache.t4g.medium"
    replicas        = 1
  }

  audit_archive_retention_days = 30
  backup                       = null

  images = {
    api     = "${var.image_registry}/archova/api:bootstrap"
    web     = "${var.image_registry}/archova/web:bootstrap"
    migrate = "${var.image_registry}/archova/migrate:bootstrap"
    worker  = "${var.image_registry}/archova/worker:bootstrap"
  }

  services = {
    api = { cpu = 1024, memory = 2048, min = 2, max = 4, desired = 2 }
    web = { cpu = 1024, memory = 2048, min = 2, max = 4, desired = 2 }
  }

  deletion_protection = true
  ci                  = {}

  log_retention_days = 90
}

output "cell" {
  value = module.cell
}

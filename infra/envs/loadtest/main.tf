# loadtest: built on demand from the same Terraform as prod, sized to the 100k-user target, seeded with synthetic
# data, torn down after each run (infrastructure/02 §1, 04 §7).

module "cell" {
  source = "../../cells/cell"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
    aws.dns       = aws # loadtest.<domain> is delegated to this account
  }

  env         = "loadtest"
  cell        = "c1"
  app_host    = "app.loadtest.${var.domain}"
  api_host    = "api.loadtest.${var.domain}"
  dns_zone_id = var.dns_zone_id
  waf_block   = true

  vpc_cidr                = "10.40.0.0/16"
  az_count                = 3
  nat_gateway_count       = 3
  firewall_endpoint_count = 3
  egress_allowlist        = yamldecode(file("${path.module}/egress-allowlist.yaml"))

  aurora = {
    instance_class        = "db.r7g.2xlarge"
    instance_count        = 3
    io_optimized          = true
    backup_retention_days = 1
  }

  valkey = {
    split               = true
    queue_node_type     = "cache.r7g.large"
    cache_node_type     = "cache.r7g.large"
    replicas            = 1
    queue_snapshot_days = 0
  }

  audit_archive_retention_days = 1
  backup                       = null

  images = {
    api     = "${var.image_registry}/archova/api:bootstrap"
    web     = "${var.image_registry}/archova/web:bootstrap"
    migrate = "${var.image_registry}/archova/migrate:bootstrap"
  }

  # Target tier from infrastructure/04 §3: api 10-40 (max 60), web 6-20 (max 30).
  services = {
    api = { cpu = 1024, memory = 2048, min = 10, max = 60, desired = 10 }
    web = { cpu = 1024, memory = 2048, min = 6, max = 30, desired = 6 }
  }

  deletion_protection   = false
  force_destroy_buckets = true
  log_retention_days    = 14
}

output "cell" {
  value = module.cell
}

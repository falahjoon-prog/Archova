# demo: a working Archova at demo.archova.com.au with synthetic sample projects, for john and pilot builders to
# click through. Synthetic data only, never customer data. Sized for cost, not resilience: two AZs (ALB and
# Aurora need two), one NAT, one firewall endpoint, interface endpoints in one AZ, Aurora Serverless v2 that
# pauses when idle, one small Valkey node and the smallest Fargate tasks. Its own account (archova-demo).

data "aws_route53_zone" "apex" {
  provider = aws.dns
  name     = var.domain
}

module "cell" {
  source = "../../cells/cell"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
    aws.dns       = aws.dns # demo. and api.demo. records go in the apex zone in shared-services
  }

  env         = "demo"
  cell        = "c1"
  app_host    = "demo.${var.domain}"
  api_host    = "api.demo.${var.domain}"
  dns_zone_id = data.aws_route53_zone.apex.zone_id
  waf_block   = true

  vpc_cidr                    = "10.50.0.0/16"
  az_count                    = 2
  nat_gateway_count           = 1
  firewall_endpoint_count     = 1
  interface_endpoint_az_count = 1
  egress_allowlist            = yamldecode(file("${path.module}/egress-allowlist.yaml"))

  aurora = {
    instance_class        = "db.serverless"
    instance_count        = 1
    serverless_min_acu    = 0
    serverless_max_acu    = 2
    auto_pause_seconds    = 3600 # the first click after an idle hour waits about 15 seconds while it resumes
    io_optimized          = false
    backup_retention_days = 1
    enable_proxy          = false
  }

  valkey = {
    split               = false
    queue_node_type     = "cache.t4g.micro"
    replicas            = 0
    queue_snapshot_days = 0
  }

  audit_archive_retention_days = 1
  backup                       = null

  images = {
    api     = "${var.image_registry}/archova/api:bootstrap"
    web     = "${var.image_registry}/archova/web:bootstrap"
    migrate = "${var.image_registry}/archova/migrate:bootstrap"
  }

  services = {
    api = { cpu = 512, memory = 1024, min = 1, max = 2, desired = 1 }
    web = { cpu = 512, memory = 1024, min = 1, max = 2, desired = 1 }
  }

  enable_execute_command = false
  deletion_protection    = false
  force_destroy_buckets  = true
  ci                     = {}

  log_retention_days = 30
}

output "cell" {
  value = module.cell
}

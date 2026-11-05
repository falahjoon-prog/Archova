# demo: a working Archova at demo.archova.com.au with synthetic sample projects, for john and pilot builders to
# click through. Synthetic data only, never customer data. Sized for cost, not resilience: two AZs (ALB and
# Aurora need two), one NAT and no egress firewall, interface endpoints in one AZ, Aurora Serverless v2 that
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
  firewall_endpoint_count     = 0 # no egress firewall: sample data only (john, 2 Oct 2026); DNS Firewall stays
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

  audit_archive_retention_days   = 1
  claims_evidence_retention_days = 1
  backup                         = null

  images = {
    api       = "${var.image_registry}/archova/api:bootstrap"
    web       = "${var.image_registry}/archova/web:bootstrap"
    migrate   = "${var.image_registry}/archova/migrate:bootstrap"
    worker    = "${var.image_registry}/archova/worker:bootstrap"
    ai-worker = "${var.image_registry}/archova/ai-worker:bootstrap"
  }

  # Short canary and bake: a demo deploy finishes in about ten minutes instead of the production 40.
  services = {
    api = { cpu = 512, memory = 1024, min = 1, max = 2, desired = 1, deployment = local.quick_deploy }
    web = { cpu = 512, memory = 1024, min = 1, max = 2, desired = 1, deployment = local.quick_deploy }
  }

  # Bedrock AU inference profiles (Ari, 2 Oct 2026). Sonnet 5.5 has no au. profile, so standard is Sonnet 5.
  # Confirm with `aws bedrock list-inference-profiles --region ap-southeast-2` and enable model access first.
  ai_models = {
    fast     = "au.anthropic.claude-haiku-4-5-20251001-v1:0"
    standard = "au.anthropic.claude-sonnet-5"
    advanced = "au.anthropic.claude-opus-5-5"
  }

  enable_execute_command = false
  deletion_protection    = false
  force_destroy_buckets  = true
  ci                     = {}

  log_retention_days = 30
}

locals {
  quick_deploy = { canary_percent = 50, canary_minutes = 2, bake_minutes = 5 }
}

output "cell" {
  value = module.cell
}

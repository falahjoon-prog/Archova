# A cell is one complete copy of the Archova stack (infrastructure/01 §7, Ava D5/D12). Every environment is one
# call of this module with different sizes; standing up cell 2 is a new envs/ folder and account, not new code.

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  name    = "archova-${var.env}-${var.cell}"
  region  = data.aws_region.current.region
  account = data.aws_caller_identity.current.account_id
  acct6   = substr(local.account, 6, 6)

  tags = merge(var.tags, {
    env           = var.env
    cell          = var.cell
    owner         = "owen"
    "cost-centre" = "platform"
    service       = "shared"
  })

  # Resource name for a service: archova-<env>-<cell>-<service> (X24).
  svc = { for s in concat(keys(var.services), ["worker"]) : s => "${local.name}-${s}" }
}

resource "aws_ecs_cluster" "this" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "enhanced"
  }

  tags = local.tags
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

# Non-secret configuration for tools and other stacks (infrastructure/02 §5).
resource "aws_ssm_parameter" "config" {
  for_each = {
    "files-bucket"     = module.files.id
    "exports-bucket"   = module.exports.id
    "static-bucket"    = module.static_web.id
    "aurora-writer"    = module.aurora.writer_endpoint
    "aurora-reader"    = module.aurora.reader_endpoint
    "ecs-cluster"      = aws_ecs_cluster.this.name
    "app-host"         = var.app_host
    "api-host"         = var.api_host
    "egress-ips"       = jsonencode(module.network.nat_public_ips)
    "private-subnets"  = jsonencode(module.network.private_subnet_ids)
    "migrate-sg"       = aws_security_group.migrate.id
    "app-distribution" = module.edge.app_distribution_arn
  }
  name  = "/archova/${var.env}/${var.cell}/${each.key}"
  type  = "String"
  value = each.value
  tags  = local.tags
}

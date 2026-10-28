# The background worker (apps/worker): the outbox relay and the event subscribers. No inbound port, so no ALB
# target group, no blue/green and no HTTP alarms; ECS rolls it as a plain rolling update. It sits in the private
# subnets because it needs only Aurora and Valkey (no AI, no external egress). The relay connects as app_platform
# (cross-tenant, column-limited grants on shared.outbox only); subscribers connect as app_rw like the api.

locals {
  worker = {
    cpu     = 512
    memory  = 1024
    min     = 1
    max     = 2
    desired = 1
  }
}

module "worker" {
  source = "../../modules/ecs-service"

  name         = local.svc["worker"]
  service      = "worker"
  cluster_arn  = aws_ecs_cluster.this.arn
  cluster_name = aws_ecs_cluster.this.name
  vpc_id       = module.network.vpc_id
  subnet_ids   = module.network.private_subnet_ids
  image        = var.images["worker"]
  cpu          = local.worker.cpu
  memory       = local.worker.memory
  environment  = { NODE_ENV = "production", LOG_LEVEL = "info" }
  secrets = {
    DATABASE_URL          = "${module.aurora.role_secret_arns["app_rw"]}:url::"
    DATABASE_PLATFORM_URL = "${module.aurora.role_secret_arns["app_platform"]}:url::"
    REDIS_URL             = "${module.valkey_queue.secret_arn}:url::"
  }
  secret_arns = [
    module.aurora.role_secret_arns["app_rw"],
    module.aurora.role_secret_arns["app_platform"],
    module.valkey_queue.secret_arn,
  ]
  secrets_kms_key_arn      = module.kms_secrets.arn
  task_role_arn            = aws_iam_role.task["worker"].arn
  readonly_root_filesystem = true
  desired_count            = local.worker.desired
  min_count                = local.worker.min
  max_count                = local.worker.max
  enable_execute_command   = var.enable_execute_command
  logs_kms_key_arn         = module.kms_logs.arn
  log_retention_days       = var.log_retention_days

  tags = merge(local.tags, { service = "worker" })
}

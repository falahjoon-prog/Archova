# ECS services (infrastructure/01 §5). api and ai-worker run in the restricted subnets behind the egress
# allow-list; everything else in the private subnets. realtime, worker groups, events-relay, ai-worker,
# webhook-worker and scheduler are added here as their apps are built (apps/*/README.md).

locals {
  rollback_alarms = { for s in keys(var.services) : s => ["${local.svc[s]}-5xx-rate", "${local.svc[s]}-p95-latency"] }

  service_config = {
    api = {
      port       = 4000
      subnets    = module.network.restricted_subnet_ids
      health     = "/health/live"
      priority   = 100
      hosts      = [var.app_host, var.api_host]
      paths      = ["/v1/*", "/.well-known/*"]
      readonly   = true
      p95_target = 0.6 # 2x the 300 ms read SLO (infrastructure/04 §2)
      environment = {
        NODE_ENV            = "production"
        API_PORT            = "4000"
        API_APP_ORIGINS     = "https://${var.app_host}"
        API_PUBLIC_HOSTS    = var.api_host
        API_WEB_SIGN_IN_URL = "https://${var.app_host}/login"
        API_JWT_ISSUER      = "https://${var.api_host}"
        # CloudFront and the ALB forward the viewer Host unchanged, so the api must not trust X-Forwarded-Host
        # (a client could send its own through CloudFront).
        API_TRUST_PROXY  = "false"
        API_FILES_STORE  = "s3"
        API_FILES_BUCKET = module.files.id
        API_FILES_REGION = local.region
        LOG_LEVEL        = "info"
      }
      secrets = {
        API_DATABASE_URL    = "${module.aurora.role_secret_arns["app_rw"]}:url::"
        API_REDIS_URL       = "${module.valkey_queue.secret_arn}:url::"
        API_JWT_PRIVATE_JWK = aws_secretsmanager_secret.jwt_signing_key.arn
      }
      secret_arns = [
        module.aurora.role_secret_arns["app_rw"],
        module.valkey_queue.secret_arn,
        aws_secretsmanager_secret.jwt_signing_key.arn,
      ]
    }

    web = {
      port       = 3000
      subnets    = module.network.private_subnet_ids
      health     = "/login"
      priority   = 200
      hosts      = [var.app_host]
      paths      = ["/*"]
      readonly   = false # Next.js writes its ISR and image cache under .next/cache
      p95_target = 1.0
      environment = {
        NODE_ENV = "production"
        PORT     = "3000"
        HOSTNAME = "0.0.0.0"
      }
      secrets     = {}
      secret_arns = []
    }
  }
}

module "service" {
  source   = "../../modules/ecs-service"
  for_each = var.services

  name                     = local.svc[each.key]
  service                  = each.key
  cluster_arn              = aws_ecs_cluster.this.arn
  cluster_name             = aws_ecs_cluster.this.name
  vpc_id                   = module.network.vpc_id
  subnet_ids               = local.service_config[each.key].subnets
  image                    = var.images[each.key]
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  container_port           = local.service_config[each.key].port
  environment              = local.service_config[each.key].environment
  secrets                  = local.service_config[each.key].secrets
  secret_arns              = local.service_config[each.key].secret_arns
  secrets_kms_key_arn      = module.kms_secrets.arn
  task_role_arn            = aws_iam_role.task[each.key].arn
  readonly_root_filesystem = local.service_config[each.key].readonly
  desired_count            = each.value.desired
  min_count                = each.value.min
  max_count                = each.value.max
  requests_per_target      = each.value.requests_per_target
  scheduled_floors         = each.value.scheduled_floors
  use_spot                 = each.value.spot
  enable_execute_command   = var.enable_execute_command
  logs_kms_key_arn         = module.kms_logs.arn
  log_retention_days       = var.log_retention_days
  ingress_security_groups  = { alb = aws_security_group.alb.id }
  rollback_alarm_names     = local.rollback_alarms[each.key]

  load_balancer = {
    listener_arn        = aws_lb_listener.https.arn
    priority            = local.service_config[each.key].priority
    host_headers        = local.service_config[each.key].hosts
    path_patterns       = local.service_config[each.key].paths
    origin_header_name  = local.origin_header_name
    origin_header_value = random_password.origin_header.result
    health_check_path   = local.service_config[each.key].health
    infrastructure_role = aws_iam_role.ecs_infrastructure.arn
  }

  tags = merge(local.tags, { service = each.key })
}

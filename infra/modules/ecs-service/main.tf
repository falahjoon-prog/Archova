# One ECS Fargate service (infrastructure/01 §5): linux/arm64, logs to CloudWatch, secrets from Secrets Manager,
# target-tracking autoscaling, and native ECS blue/green with a canary step when it sits behind the ALB.

data "aws_region" "current" {}

locals {
  tags    = merge(var.tags, { "archova:service" = var.service })
  with_lb = var.load_balancer != null

  container = merge(
    {
      name                   = var.service
      image                  = var.image
      essential              = true
      readonlyRootFilesystem = var.readonly_root_filesystem
      environment            = [for k in sort(keys(var.environment)) : { name = k, value = var.environment[k] }]
      secrets                = [for k in sort(keys(var.secrets)) : { name = k, valueFrom = var.secrets[k] }]
      mountPoints            = [{ sourceVolume = "tmp", containerPath = "/tmp", readOnly = false }]
      linuxParameters        = { initProcessEnabled = true }
      stopTimeout            = 30
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.this.name
          awslogs-region        = data.aws_region.current.region
          awslogs-stream-prefix = var.service
          mode                  = "non-blocking"
          max-buffer-size       = "25m"
        }
      }
    },
    var.command == null ? {} : { command = var.command },
    var.container_port == null ? {} : { portMappings = [{ containerPort = var.container_port, protocol = "tcp" }] },
  )
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/archova/${var.name}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.logs_kms_key_arn
  tags              = local.tags
}

# --- Execution role: pull the image, write logs, read this service's secrets -----------------------------------

resource "aws_iam_role" "execution" {
  name = "${var.name}-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = var.secret_arns
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [var.secrets_kms_key_arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${data.aws_region.current.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  count  = length(var.secret_arns) > 0 ? 1 : 0
  name   = "read-service-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# --- Task definition -----------------------------------------------------------------------------------------

resource "aws_ecs_task_definition" "this" {
  family                   = var.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = var.task_role_arn
  container_definitions    = jsonencode([local.container])

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  volume {
    name = "tmp"
  }

  tags = local.tags
}

# --- Networking ----------------------------------------------------------------------------------------------

resource "aws_security_group" "this" {
  name        = var.name
  description = "${var.service} tasks"
  vpc_id      = var.vpc_id
  tags        = merge(local.tags, { Name = var.name })
}

resource "aws_vpc_security_group_ingress_rule" "from" {
  for_each                     = var.container_port == null ? {} : var.ingress_security_groups
  security_group_id            = aws_security_group.this.id
  description                  = "Service port from the load balancer"
  referenced_security_group_id = each.value
  from_port                    = var.container_port
  to_port                      = var.container_port
  ip_protocol                  = "tcp"
}

# Egress is open at the security group; the Network Firewall decides what leaves the VPC (infrastructure/01 §3.1).
resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.this.id
  description       = "Egress is filtered by Network Firewall"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# --- Load balancer (blue/green) ------------------------------------------------------------------------------

resource "aws_lb_target_group" "this" {
  for_each             = local.with_lb ? toset(["blue", "green"]) : toset([])
  name                 = substr("${replace(var.name, "archova-", "")}-${each.key}", 0, 32)
  port                 = var.container_port
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 30

  health_check {
    path                = var.load_balancer.health_check_path
    matcher             = "200"
    interval            = 10
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = local.tags
}

resource "aws_lb_listener_rule" "this" {
  count        = local.with_lb ? 1 : 0
  listener_arn = var.load_balancer.listener_arn
  priority     = var.load_balancer.priority

  action {
    type = "forward"
    forward {
      target_group {
        arn    = aws_lb_target_group.this["blue"].arn
        weight = 100
      }
      target_group {
        arn    = aws_lb_target_group.this["green"].arn
        weight = 0
      }
    }
  }

  condition {
    host_header {
      values = var.load_balancer.host_headers
    }
  }

  condition {
    path_pattern {
      values = var.load_balancer.path_patterns
    }
  }

  # Only CloudFront knows this header, so nobody can reach the ALB around the WAF (infrastructure/01 §4).
  condition {
    http_header {
      http_header_name = var.load_balancer.origin_header_name
      values           = [var.load_balancer.origin_header_value]
    }
  }

  tags = local.tags

  lifecycle {
    ignore_changes = [action] # ECS moves the weights during deployments
  }
}

# --- Service -------------------------------------------------------------------------------------------------

resource "aws_ecs_service" "this" {
  name                               = var.service
  cluster                            = var.cluster_arn
  task_definition                    = aws_ecs_task_definition.this.arn
  desired_count                      = var.desired_count
  enable_execute_command             = var.enable_execute_command
  propagate_tags                     = "SERVICE"
  enable_ecs_managed_tags            = true
  health_check_grace_period_seconds  = local.with_lb ? 30 : null
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  availability_zone_rebalancing      = "ENABLED"

  capacity_provider_strategy {
    capacity_provider = var.use_spot ? "FARGATE_SPOT" : "FARGATE"
    weight            = 1
  }

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.this.id]
    assign_public_ip = false
  }

  deployment_controller {
    type = "ECS"
  }

  dynamic "deployment_configuration" {
    for_each = local.with_lb ? [1] : []
    content {
      strategy             = "CANARY"
      bake_time_in_minutes = var.deployment.bake_minutes
      canary_configuration {
        canary_percent              = var.deployment.canary_percent
        canary_bake_time_in_minutes = var.deployment.canary_minutes
      }
    }
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  dynamic "alarms" {
    for_each = length(var.rollback_alarm_names) > 0 ? [1] : []
    content {
      alarm_names = var.rollback_alarm_names
      enable      = true
      rollback    = true
    }
  }

  dynamic "load_balancer" {
    for_each = local.with_lb ? [1] : []
    content {
      target_group_arn = aws_lb_target_group.this["blue"].arn
      container_name   = var.service
      container_port   = var.container_port
      advanced_configuration {
        alternate_target_group_arn = aws_lb_target_group.this["green"].arn
        production_listener_rule   = aws_lb_listener_rule.this[0].arn
        role_arn                   = var.load_balancer.infrastructure_role
      }
    }
  }

  tags = local.tags

  lifecycle {
    # The deploy pipeline registers new task definitions (new image digests); autoscaling owns the count.
    ignore_changes = [task_definition, desired_count]
  }
}

# --- Autoscaling ---------------------------------------------------------------------------------------------

resource "aws_appautoscaling_target" "this" {
  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = "service/${var.cluster_name}/${aws_ecs_service.this.name}"
  min_capacity       = var.min_count
  max_capacity       = var.max_count
  tags               = local.tags
}

resource "aws_appautoscaling_policy" "cpu" {
  name               = "${var.name}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.this.service_namespace
  scalable_dimension = aws_appautoscaling_target.this.scalable_dimension
  resource_id        = aws_appautoscaling_target.this.resource_id

  target_tracking_scaling_policy_configuration {
    target_value       = var.cpu_target
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

resource "aws_appautoscaling_policy" "requests" {
  count              = local.with_lb && var.requests_per_target != null ? 1 : 0
  name               = "${var.name}-requests"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.this.service_namespace
  scalable_dimension = aws_appautoscaling_target.this.scalable_dimension
  resource_id        = aws_appautoscaling_target.this.resource_id

  target_tracking_scaling_policy_configuration {
    target_value       = var.requests_per_target
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${data.aws_lb.this[0].arn_suffix}/${aws_lb_target_group.this["blue"].arn_suffix}"
    }
  }
}

data "aws_lb_listener" "this" {
  count = local.with_lb && var.requests_per_target != null ? 1 : 0
  arn   = var.load_balancer.listener_arn
}

data "aws_lb" "this" {
  count = local.with_lb && var.requests_per_target != null ? 1 : 0
  arn   = data.aws_lb_listener.this[0].load_balancer_arn
}

resource "aws_appautoscaling_scheduled_action" "floor" {
  for_each           = { for f in var.scheduled_floors : f.name => f }
  name               = "${var.name}-${each.key}"
  service_namespace  = aws_appautoscaling_target.this.service_namespace
  scalable_dimension = aws_appautoscaling_target.this.scalable_dimension
  resource_id        = aws_appautoscaling_target.this.resource_id
  schedule           = each.value.schedule
  timezone           = "Australia/Sydney"

  scalable_target_action {
    min_capacity = each.value.min
    max_capacity = each.value.max
  }
}

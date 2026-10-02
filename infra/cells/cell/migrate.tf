# Database migrations run as a one-off ECS task with the new image before new code takes traffic
# (infrastructure/03 §5): the migrate image runs tools/db/migrate.js (pnpm db:migrate, bundled) as
# app_migrator, straight to the writer (not through RDS Proxy).

resource "aws_security_group" "migrate" {
  name        = "${local.name}-migrate"
  description = "One-off database tasks"
  vpc_id      = module.network.vpc_id
  tags        = merge(local.tags, { Name = "${local.name}-migrate", service = "migrate" })
}

resource "aws_vpc_security_group_egress_rule" "migrate" {
  security_group_id = aws_security_group.migrate.id
  description       = "Egress is filtered by Network Firewall"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/archova/${local.name}-migrate"
  retention_in_days = var.log_retention_days
  kms_key_id        = module.kms_logs.arn
  tags              = merge(local.tags, { service = "migrate" })
}

resource "aws_iam_role" "migrate_execution" {
  name = "${local.name}-migrate-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
  tags = merge(local.tags, { service = "migrate" })
}

resource "aws_iam_role_policy_attachment" "migrate_execution" {
  role       = aws_iam_role.migrate_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "migrate_execution" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [module.aurora.role_secret_arns["app_migrator"]]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [module.kms_secrets.arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${local.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "migrate_execution" {
  name   = "read-migrator-secret"
  role   = aws_iam_role.migrate_execution.id
  policy = data.aws_iam_policy_document.migrate_execution.json
}

resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.migrate_execution.arn
  task_role_arn            = aws_iam_role.task["migrate"].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name                   = "migrate"
    image                  = var.images["migrate"]
    essential              = true
    readonlyRootFilesystem = true
    command                = ["--enable-source-maps", "tools/db/migrate.js"]
    secrets = [
      { name = "MIGRATOR_DATABASE_URL", valueFrom = "${module.aurora.role_secret_arns["app_migrator"]}:url::" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.migrate.name
        awslogs-region        = local.region
        awslogs-stream-prefix = "migrate"
      }
    }
  }])

  tags = merge(local.tags, { service = "migrate" })

  lifecycle {
    ignore_changes = [container_definitions] # the deploy pipeline sets the image digest per release
  }
}

# db-roles: creates or updates the application roles from their secrets, as the RDS-managed master user, before
# migrations run (tools/db/roles.ts). Same image as migrate; the only task that can read the master secret.
resource "aws_iam_role" "db_roles_execution" {
  name = "${local.name}-db-roles-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
  tags = merge(local.tags, { service = "migrate" })
}

resource "aws_iam_role_policy_attachment" "db_roles_execution" {
  role       = aws_iam_role.db_roles_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "db_roles_execution" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = concat([module.aurora.master_secret_arn], values(module.aurora.role_secret_arns))
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [module.kms_secrets.arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${local.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "db_roles_execution" {
  name   = "read-database-secrets"
  role   = aws_iam_role.db_roles_execution.id
  policy = data.aws_iam_policy_document.db_roles_execution.json
}

resource "aws_ecs_task_definition" "db_roles" {
  family                   = "${local.name}-db-roles"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.db_roles_execution.arn
  task_role_arn            = aws_iam_role.task["migrate"].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name                   = "db-roles"
    image                  = var.images["migrate"]
    essential              = true
    readonlyRootFilesystem = true
    command                = ["--enable-source-maps", "tools/db/roles.js"]
    environment = [
      { name = "DB_HOST", value = module.aurora.writer_endpoint },
      { name = "DB_NAME", value = module.aurora.database_name },
    ]
    secrets = concat(
      [{ name = "DB_MASTER_SECRET", valueFrom = module.aurora.master_secret_arn }],
      [for role, arn in module.aurora.role_secret_arns : { name = "DB_ROLE_${upper(role)}", valueFrom = arn }],
    )
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.migrate.name
        awslogs-region        = local.region
        awslogs-stream-prefix = "db-roles"
      }
    }
  }])

  tags = merge(local.tags, { service = "migrate" })

  lifecycle {
    ignore_changes = [container_definitions] # the deploy pipeline sets the image digest per release
  }
}

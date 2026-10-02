variable "name" {
  description = "archova-<env>-<cell>-<service>."
  type        = string
}

variable "service" {
  description = "Short service name used as the container name: web, api, realtime, worker-pdf, ..."
  type        = string
}

variable "cluster_arn" {
  type = string
}

variable "cluster_name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "private subnets for web, realtime and workers; restricted subnets for api and ai-worker."
  type        = list(string)
}

variable "image" {
  description = "Image reference, by digest once CI publishes images (repo@sha256:...)."
  type        = string
}

variable "command" {
  description = "Override the image command (e.g. a worker queue group)."
  type        = list(string)
  default     = null
}

variable "cpu" {
  description = "Fargate CPU units (1024 = 1 vCPU)."
  type        = number
}

variable "memory" {
  description = "Fargate memory in MiB."
  type        = number
}

variable "container_port" {
  description = "Port the container listens on; null for services without a load balancer."
  type        = number
  default     = null
}

variable "environment" {
  description = "Plain configuration (non-secret)."
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Env var -> Secrets Manager ARN, optionally with a JSON key (arn:...:secret:name:url::)."
  type        = map(string)
  default     = {}
}

variable "secret_arns" {
  description = "Secret ARNs the execution role may read (without the JSON key suffix)."
  type        = list(string)
  default     = []
}

variable "secrets_kms_key_arn" {
  type = string
}

variable "task_role_arn" {
  description = "Role the application runs as; created by the cell so KMS key policies can name it."
  type        = string
}

variable "readonly_root_filesystem" {
  type    = bool
  default = true
}

variable "desired_count" {
  type    = number
  default = 2
}

variable "min_count" {
  type    = number
  default = 2
}

variable "max_count" {
  type    = number
  default = 4
}

variable "cpu_target" {
  description = "Target tracking on average CPU (infrastructure/04 §4: 55% for api and web)."
  type        = number
  default     = 55
}

variable "requests_per_target" {
  description = "Target tracking on ALB requests per target; null until the first load test sets it (~120)."
  type        = number
  default     = null
}

variable "scheduled_floors" {
  description = "Raise min_count on a schedule, e.g. the 6am AEST weekday ramp (infrastructure/04 §4)."
  type = list(object({
    name     = string
    schedule = string
    min      = number
    max      = number
  }))
  default = []
}

variable "use_spot" {
  description = "Run on Fargate Spot (dev everything; staging and prod retryable workers only)."
  type        = bool
  default     = false
}

variable "enable_execute_command" {
  type    = bool
  default = false
}

variable "log_retention_days" {
  type    = number
  default = 90
}

variable "logs_kms_key_arn" {
  type = string
}

variable "ingress_security_groups" {
  description = "Security groups allowed to reach container_port (the ALB), keyed by a static name."
  type        = map(string)
  default     = {}
}

variable "load_balancer" {
  description = "Listener rule this service receives traffic from, with ECS blue/green between two target groups."
  type = object({
    listener_arn        = string
    priority            = number
    host_headers        = list(string)
    path_patterns       = list(string)
    origin_header_name  = string
    origin_header_value = string
    health_check_path   = string
    infrastructure_role = string
  })
  default = null
}

variable "deployment" {
  description = "Blue/green canary: canary_percent of traffic for canary_minutes, then all of it; the old task set is kept bake_minutes for instant rollback (infrastructure/03 §4)."
  type = object({
    canary_percent = number
    canary_minutes = number
    bake_minutes   = number
  })
  default = {
    canary_percent = 10
    canary_minutes = 10
    bake_minutes   = 30
  }
}

variable "rollback_alarm_names" {
  description = "CloudWatch alarms that roll a deployment back (5xx rate, p95 latency, error-budget burn)."
  type        = list(string)
  default     = []
}

variable "tags" {
  type    = map(string)
  default = {}
}

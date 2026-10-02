variable "name" {
  description = "archova-<env>-<cell>-aurora."
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "Data subnets."
  type        = list(string)
}

variable "client_security_groups" {
  description = "Security groups of the tasks that may connect, keyed by a static name (api, migrate, ...)."
  type        = map(string)
}

variable "engine_version" {
  type    = string
  default = "16.8"
}

variable "database_name" {
  type    = string
  default = "archova"
}

variable "instance_class" {
  description = "db.r7g.large in staging and prod, db.serverless in dev."
  type        = string
}

variable "instance_count" {
  description = "Writer plus readers. 2 = 1 writer + 1 reader."
  type        = number
  default     = 2
}

variable "serverless_min_acu" {
  type    = number
  default = 0.5
}

variable "serverless_max_acu" {
  type    = number
  default = 4
}

variable "serverless_auto_pause_seconds" {
  description = "With serverless_min_acu = 0, pause the cluster after this many idle seconds (demo only). Null keeps it running."
  type        = number
  default     = null

  validation {
    condition     = var.serverless_auto_pause_seconds == null || (coalesce(var.serverless_auto_pause_seconds, 300) >= 300 && coalesce(var.serverless_auto_pause_seconds, 300) <= 86400)
    error_message = "Auto-pause takes 300 to 86400 seconds."
  }
}

variable "io_optimized" {
  description = "Aurora I/O-Optimized storage (staging, prod)."
  type        = bool
  default     = true
}

variable "backup_retention_days" {
  description = "PITR window: 1 dev, 7 staging, 35 prod (infrastructure/02 §3)."
  type        = number
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "skip_final_snapshot" {
  type    = bool
  default = false
}

variable "kms_key_arn" {
  description = "Data-class key for the database."
  type        = string
}

variable "secrets_kms_key_arn" {
  description = "Key for the database credential secrets."
  type        = string
}

variable "app_roles" {
  description = "Login roles the application uses (README: app_migrator owns schemas; app_rw has no BYPASSRLS). One secret each; created in the database by the db-roles task."
  type        = list(string)
  default     = ["app_migrator", "app_rw", "app_platform", "app_admin"]
}

variable "proxied_roles" {
  description = "Roles that connect through RDS Proxy. app_migrator connects to the writer directly so DDL never runs through the pooler."
  type        = list(string)
  default     = ["app_rw", "app_platform", "app_admin"]
}

variable "enable_proxy" {
  type    = bool
  default = true
}

variable "credentials_version" {
  description = "Bump to generate and store new passwords for the app roles (then run the db-roles task)."
  type        = number
  default     = 1
}

variable "monitoring_interval" {
  description = "Enhanced Monitoring interval in seconds; 0 disables."
  type        = number
  default     = 60
}

variable "logs_kms_key_arn" {
  description = "Key for the exported PostgreSQL log group."
  type        = string
}

variable "log_retention_days" {
  type    = number
  default = 365
}

variable "tags" {
  type    = map(string)
  default = {}
}

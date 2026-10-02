variable "name" {
  description = "archova-<env>-<cell>-valkey-<purpose>."
  type        = string
}

variable "purpose" {
  description = "queue (BullMQ jobs and domain events, noeviction) or cache (allkeys-lru). Separate clusters so cache pressure never evicts jobs (infrastructure/01 §6)."
  type        = string

  validation {
    condition     = contains(["queue", "cache", "shared"], var.purpose)
    error_message = "purpose is queue, cache or shared (one cluster for both, dev only)."
  }
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "Data subnets."
  type        = list(string)
}

variable "client_security_groups" {
  description = "Security groups of the tasks that may connect, keyed by a static name."
  type        = map(string)
}

variable "node_type" {
  description = "cache.t4g.small dev, cache.t4g.medium pilots, cache.r7g.large from ~1k users."
  type        = string
}

variable "replicas" {
  description = "Replicas besides the primary. 0 in dev; 1 from staging up (Multi-AZ failover)."
  type        = number
  default     = 1
}

variable "engine_version" {
  type    = string
  default = "8.1"
}

variable "snapshot_retention_days" {
  description = "Daily snapshots (queue cluster: 7, infrastructure/06 §2)."
  type        = number
  default     = 0
}

variable "kms_key_arn" {
  type = string
}

variable "logs_kms_key_arn" {
  type = string
}

variable "secrets_kms_key_arn" {
  type = string
}

variable "credentials_version" {
  description = "Bump to rotate the AUTH token."
  type        = number
  default     = 1
}

variable "tags" {
  type    = map(string)
  default = {}
}

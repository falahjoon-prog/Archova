variable "name" {
  type = string
}

variable "kms_key_arn" {
  description = "Key for the SNS topics."
  type        = string
}

variable "alb_arn_suffix" {
  type = string
}

variable "http_services" {
  description = "Service -> {alarm name prefix, blue and green target group ARN suffixes, p95 threshold in seconds}."
  type = map(object({
    alarm_prefix          = string
    target_groups         = list(string)
    p95_threshold_seconds = number
  }))
}

variable "aurora_cluster_identifier" {
  type = string
}

variable "valkey_queue_replication_group_id" {
  type = string
}

variable "restricted_egress_metric" {
  type = object({
    namespace = string
    name      = string
  })
}

variable "tags" {
  type    = map(string)
  default = {}
}

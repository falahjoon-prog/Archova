variable "management_account_id" {
  type = string
}

variable "workloads_ou_id" {
  description = "Workloads OU (archova-dev, -staging, -prod, -marketing, -loadtest). OUs and accounts come from the Control Tower landing zone and Account Factory."
  type        = string
}

variable "infrastructure_ou_id" {
  description = "Infrastructure OU (shared-services, backup)."
  type        = string
}

variable "security_ou_id" {
  description = "Security OU (security-tooling, log-archive)."
  type        = string
}

variable "log_archive_bucket_arns" {
  description = "Log archive buckets nobody may delete (Control Tower's logging buckets plus ours)."
  type        = list(string)
  default     = []
}

variable "break_glass_role_arn_pattern" {
  description = "Only this role (management account, hardware MFA, alarmed) may create IAM users or keys."
  type        = string
  default     = "arn:aws:iam::*:role/archova-break-glass"
}

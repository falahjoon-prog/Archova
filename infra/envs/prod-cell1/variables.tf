variable "account_id" {
  description = "The archova-prod AWS account id. Terraform refuses to run against any other account."
  type        = string
}

variable "size" {
  description = "lean for the pilots (about A$1,300-1,950 a month before Nova), full from the first paying builder (infrastructure/09)."
  type        = string
  default     = "lean"
  validation {
    condition     = contains(["lean", "full"], var.size)
    error_message = "size must be lean or full."
  }
}

variable "domain" {
  description = "Product domain (bought by john, 2 Oct 2026)."
  type        = string
  default     = "archova.com.au"
}

variable "dns_zone_id" {
  description = "Route 53 hosted zone for <domain> (the apex zone, delegated to this account)."
  type        = string
}

variable "image_registry" {
  description = "ECR registry in shared-services, e.g. 123456789012.dkr.ecr.ap-southeast-2.amazonaws.com."
  type        = string
}

variable "dns_role_arn" {
  description = "Role in shared-services that may change records in the apex zone."
  type        = string
}

variable "backup_vault_arns" {
  description = "Vaults in the locked backup account (Sydney and Melbourne) that receive copies of every recovery point."
  type        = list(string)
  default     = []
}

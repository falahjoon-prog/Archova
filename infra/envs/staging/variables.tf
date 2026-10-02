variable "account_id" {
  description = "The archova-staging AWS account id. Terraform refuses to run against any other account."
  type        = string
}

variable "domain" {
  description = "Product domain (bought by john, 2 Oct 2026)."
  type        = string
  default     = "archova.com.au"
}

variable "dns_zone_id" {
  description = "Route 53 hosted zone for staging.<domain> in this account."
  type        = string
}

variable "image_registry" {
  description = "ECR registry in shared-services, e.g. 123456789012.dkr.ecr.ap-southeast-2.amazonaws.com."
  type        = string
}

variable "state_bucket_arn" {
  description = "Terraform state bucket in shared-services (output of envs/shared-services)."
  type        = string
}

variable "state_kms_key_arn" {
  description = "KMS key that encrypts the state bucket."
  type        = string
}

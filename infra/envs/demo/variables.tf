variable "account_id" {
  description = "The archova-demo AWS account id. Terraform refuses to run against any other account."
  type        = string
}

variable "domain" {
  description = "Product domain (bought by john, 2 Oct 2026)."
  type        = string
  default     = "archova.com.au"
}

variable "dns_role_arn" {
  description = "Role in shared-services that may change records in the archova.com.au zone (output dns_role_arn)."
  type        = string
}

variable "image_registry" {
  description = "ECR registry in shared-services, e.g. 123456789012.dkr.ecr.ap-southeast-2.amazonaws.com."
  type        = string
}

variable "account_id" {
  description = "The archova-dev AWS account id. Terraform refuses to run against any other account."
  type        = string
}

variable "domain" {
  description = "Product domain (bought by john, 2 Oct 2026)."
  type        = string
  default     = "archova.com.au"
}

variable "dns_zone_id" {
  description = "Route 53 hosted zone for dev.<domain> in this account."
  type        = string
}

variable "image_registry" {
  description = "ECR registry in shared-services, e.g. 123456789012.dkr.ecr.ap-southeast-2.amazonaws.com."
  type        = string
}

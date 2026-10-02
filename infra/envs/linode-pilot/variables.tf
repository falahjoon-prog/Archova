variable "domain" {
  description = "Product domain (bought by john, 2 Oct 2026)."
  type        = string
  default     = "archova.com.au"
}

variable "region" {
  description = "Linode region for the servers, database and NodeBalancer: Sydney."
  type        = string
  default     = "ap-southeast"
}

variable "files_region" {
  description = "Object Storage region for uploads. Sydney if it offers Object Storage (`linode-cli object-storage endpoints`), otherwise au-mel."
  type        = string
  default     = "ap-southeast"
}

variable "backup_region" {
  description = "Object Storage region for the off-site copies: Melbourne, a different city from the servers (infrastructure/09 §3)."
  type        = string
  default     = "au-mel"

  validation {
    condition     = can(regex("^(au-|ap-southeast)", var.backup_region))
    error_message = "Backups stay in Australia."
  }
}

variable "app_type" {
  description = "Linode plan for each app server. g6-standard-2 is 2 vCPU / 4 GB (US$24); g6-standard-4 (8 GB) if ClamAV and the api crowd it."
  type        = string
  default     = "g6-standard-2"
}

variable "app_count" {
  description = "App servers behind the NodeBalancer. Two, so one can fail or be patched."
  type        = number
  default     = 2

  validation {
    condition     = var.app_count >= 2
    error_message = "At least two app servers."
  }
}

variable "db_type" {
  description = "Linode plan for each managed Postgres node."
  type        = string
  default     = "g6-standard-1"
}

variable "db_cluster_size" {
  description = "Managed Postgres nodes: 3 is a primary with two standbys and automatic failover."
  type        = number
  default     = 3
}

variable "admin_ssh_keys" {
  description = "Public SSH keys for the deploy user (Jeff and the deploy pipeline). Root login is disabled."
  type        = list(string)
}

variable "admin_cidrs" {
  description = "Addresses that may SSH to the app servers: the deploy pipeline's runner and an admin's IP. Nothing else."
  type        = list(string)
}

variable "tls_certificate" {
  description = "PEM certificate chain for app. and api. on the NodeBalancer, renewed by the deploy pipeline (Let's Encrypt, DNS-01)."
  type        = string
  sensitive   = true
}

variable "tls_private_key" {
  description = "PEM private key for tls_certificate."
  type        = string
  sensitive   = true
}

variable "aws_account_id" {
  description = "The archova-prod AWS account, for Nova (Bedrock, Textract) and SES only."
  type        = string
}

variable "roles_anywhere_ca_pem" {
  description = "Public certificate of the offline CA that issues the app servers' client certificates (docs/infrastructure/10 step 3). Never the CA's key."
  type        = string
}

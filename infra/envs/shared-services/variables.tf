variable "account_id" {
  description = "The shared-services AWS account id."
  type        = string
}

variable "workload_accounts" {
  description = "Environment -> account id for the accounts whose state lives here and that pull images: dev, staging, prod-cell1, loadtest, demo."
  type        = map(string)
}

variable "domain" {
  description = "Product domain (bought by john, 2 Oct 2026). Null skips the hosted zone."
  type        = string
  default     = "archova.com.au"
}

variable "subdomain_name_servers" {
  description = "Delegations from the apex zone: dev, staging, loadtest -> the name servers of that account's zone."
  type        = map(list(string))
  default     = {}
}

variable "repository" {
  type    = string
  default = "falahjoon-prog/Archova"
}

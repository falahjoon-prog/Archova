variable "name" {
  description = "Name prefix, archova-<env>-<cell> (X24)."
  type        = string
}

variable "cidr_block" {
  description = "VPC CIDR, a /16 (prod 10.10, staging 10.20, dev 10.30; infrastructure/01 §3)."
  type        = string

  validation {
    condition     = can(cidrhost(var.cidr_block, 0)) && endswith(var.cidr_block, "/16")
    error_message = "The VPC must be a /16 so the subnet plan in infrastructure/01 §3 fits."
  }
}

variable "az_count" {
  description = "Availability Zones to spread subnets across (2 in dev, 3 from staging up)."
  type        = number
  default     = 3

  validation {
    condition     = var.az_count >= 2 && var.az_count <= 3
    error_message = "Use 2 or 3 Availability Zones."
  }
}

variable "nat_gateway_count" {
  description = "NAT gateways: 1 in dev and staging, one per AZ in prod."
  type        = number
  default     = 1
}

variable "firewall_endpoint_count" {
  description = "Network Firewall endpoints: 1 in dev, one per AZ in staging and prod (infrastructure/01 §3.1)."
  type        = number
  default     = 1
}

variable "nat_eip_allocation_ids" {
  description = "Pre-allocated Elastic IPs for the NAT gateways. Prod passes its published egress IPs (Leo L3) so they survive a rebuild of this module; empty means allocate here."
  type        = list(string)
  default     = []
}

variable "interface_endpoints" {
  description = "AWS services reached through interface VPC endpoints instead of the NAT."
  type        = list(string)
  default     = ["ecr.api", "ecr.dkr", "logs", "secretsmanager", "kms", "sts", "ssm", "bedrock-runtime", "textract"]
}

variable "restricted_allowlist" {
  description = "Exact HTTPS hostnames the restricted subnets (api, ai-worker) may reach, from egress-allowlist.yaml. Everything else from those subnets is dropped and logged."
  type        = list(string)

  validation {
    condition     = alltrue([for h in var.restricted_allowlist : can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$", h))])
    error_message = "Allow-list entries are exact lower-case hostnames: no wildcards, schemes, ports or paths."
  }
}

variable "ai_vendor_denylist" {
  description = "AI vendor domains (and their subdomains) that the private subnets may not reach and that no subnet may resolve, from egress-allowlist.yaml."
  type        = list(string)
}

variable "log_retention_days" {
  description = "Retention for firewall, flow and DNS query logs kept in this account. The org-wide copy lives in the log-archive account."
  type        = number
  default     = 365
}

variable "logs_kms_key_arn" {
  description = "KMS key for the network log groups."
  type        = string
}

variable "deletion_protection" {
  description = "Protect the firewall from deletion (staging, prod)."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags added to every resource."
  type        = map(string)
  default     = {}
}

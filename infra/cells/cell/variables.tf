# --- Identity --------------------------------------------------------------------------------------------------

variable "env" {
  description = "dev, staging, prod, loadtest, demo."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod", "loadtest", "demo"], var.env)
    error_message = "env is dev, staging, prod, loadtest or demo."
  }
}

variable "cell" {
  description = "Cell id: c1, c2, ... (infrastructure/01 §8)."
  type        = string
  default     = "c1"
}

variable "tags" {
  description = "Extra tags. env, cell, service, owner and cost-centre are always set (tag policy, infrastructure/01 §2)."
  type        = map(string)
  default     = {}
}

# --- DNS and edge ----------------------------------------------------------------------------------------------

variable "app_host" {
  description = "Browser origin: app.<domain> in prod, app.<env>.<domain> elsewhere (infrastructure/02 §3)."
  type        = string
}

variable "api_host" {
  description = "Mobile and public API origin: api.<domain> in prod, api.<env>.<domain> elsewhere."
  type        = string
}

variable "dns_zone_id" {
  description = "Route 53 public hosted zone that holds app_host and api_host, reached through the aws.dns provider: the env's own delegated zone (dev, staging, loadtest) or the apex zone in shared-services (prod)."
  type        = string
}

variable "waf_block" {
  description = "WAF in block mode (staging, prod) or count mode (dev)."
  type        = bool
}

# --- Network ---------------------------------------------------------------------------------------------------

variable "vpc_cidr" {
  type = string
}

variable "az_count" {
  type = number
}

variable "nat_gateway_count" {
  type = number
}

variable "firewall_endpoint_count" {
  type = number
}

variable "interface_endpoint_az_count" {
  description = "AZs with interface endpoint ENIs; null for all (see modules/network)."
  type        = number
  default     = null
}

variable "nat_eip_allocation_ids" {
  description = "Prod's published egress IPs, allocated outside the cell so they are never released."
  type        = list(string)
  default     = []
}

variable "egress_allowlist" {
  description = "Decoded egress-allowlist.yaml for this environment."
  type = object({
    restricted = list(object({
      host    = string
      kind    = string
      owner   = string
      used_by = string
      reason  = string
    }))
    ai_vendor_denylist = list(string)
  })
}

# --- Data ------------------------------------------------------------------------------------------------------

variable "aurora" {
  type = object({
    instance_class        = string
    instance_count        = number
    serverless_min_acu    = optional(number, 0.5)
    serverless_max_acu    = optional(number, 4)
    auto_pause_seconds    = optional(number)
    io_optimized          = bool
    backup_retention_days = number
    enable_proxy          = optional(bool, true)
  })
}

variable "valkey" {
  description = "split = separate queue (noeviction) and cache (allkeys-lru) clusters; false = one shared noeviction cluster (dev)."
  type = object({
    split               = bool
    queue_node_type     = string
    cache_node_type     = optional(string)
    replicas            = number
    queue_snapshot_days = optional(number, 7)
  })
}

variable "audit_archive_retention_days" {
  description = "Object Lock (compliance mode) default retention for the audit archive: 2557 (7 years) in prod."
  type        = number
}

variable "backup" {
  description = "AWS Backup plan for Aurora; null disables (dev, loadtest)."
  type = object({
    daily_retention_days   = number
    monthly_retention_days = number
    yearly_retention_days  = number
    copy_to_vault_arns     = list(string)
  })
  default = null
}

# --- Compute ---------------------------------------------------------------------------------------------------

variable "images" {
  description = "Initial image per service. The deploy pipeline registers new task definitions with image digests after this."
  type        = map(string)
}

variable "services" {
  description = "Sizes per service (infrastructure/02 §3, 04 §3)."
  type = map(object({
    cpu                 = number
    memory              = number
    min                 = number
    max                 = number
    desired             = number
    spot                = optional(bool, false)
    requests_per_target = optional(number)
    deployment = optional(object({
      canary_percent = number
      canary_minutes = number
      bake_minutes   = number
    }), { canary_percent = 10, canary_minutes = 10, bake_minutes = 30 })
    scheduled_floors = optional(list(object({
      name     = string
      schedule = string
      min      = number
      max      = number
    })), [])
  }))
}

variable "files_cdn" {
  description = <<-EOT
    Drawing tiles CDN (mobile 03 §3.3): a CloudFront distribution in front of the files bucket that serves only signed
    requests under orgs/*/projects/*/tiles/*, plus the key pair the api signs with. Null builds none, and the api then
    returns tile URLs that devices cannot use. public_key_pem is the PEM public key of an RSA 2048 key pair generated
    outside Terraform (runbook: files-cdn); the private key goes into the secret this stack creates, never into state.
    allowed_countries is the viewers' geo restriction, AU by default so tiles are cached and served in Australia only (Sam).
  EOT
  type = object({
    public_key_pem    = string
    allowed_countries = optional(list(string), ["AU"])
  })
  default = null
}

variable "ai_models" {
  description = "Nova's Bedrock model ids per tier (ai/02 §3): Australian in-region ids or au. inference profiles only (X25). Null leaves them unset, and the api will not start in production until they are."
  type = object({
    fast     = string
    standard = string
    advanced = string
  })
  default = null

  validation {
    condition = var.ai_models == null || alltrue([
      for id in values(coalesce(var.ai_models, { fast = "au.x", standard = "au.x", advanced = "au.x" })) :
      startswith(id, "au.") || !can(regex("^(us|eu|apac|global|jp|ca)\\.", id))
    ])
    error_message = "Use au. inference profiles or in-region model ids; us., eu., apac. and global. profiles can leave Australia (X25)."
  }
}

variable "enable_execute_command" {
  description = "ECS Exec into tasks (dev only)."
  type        = bool
  default     = false
}

# --- Safety ----------------------------------------------------------------------------------------------------

variable "deletion_protection" {
  description = "Protect the database and load balancer from deletion (staging, prod)."
  type        = bool
}

variable "force_destroy_buckets" {
  description = "Let terraform destroy empty buckets (dev, loadtest only). Never for prod."
  type        = bool
  default     = false
}

variable "log_retention_days" {
  type = number
}

# --- CI/CD -----------------------------------------------------------------------------------------------------

variable "ci" {
  description = "GitHub Actions deploy role in this account (infrastructure/03). The OIDC provider comes from infra/bootstrap. Null skips it (e.g. loadtest, driven by Jeff)."
  type = object({
    repository = optional(string, "falahjoon-prog/Archova")
  })
  default = null
}

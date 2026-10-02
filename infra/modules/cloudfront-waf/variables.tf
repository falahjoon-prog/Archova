variable "name" {
  description = "archova-<env>-<cell>."
  type        = string
}

variable "app_host" {
  description = "Browser origin, app.<domain> (ADR-0004)."
  type        = string
}

variable "api_host" {
  description = "Mobile and public API origin, api.<domain> (ADR-0004)."
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate in us-east-1 covering app_host and api_host. Null serves the default *.cloudfront.net certificate with no aliases (before the domain exists)."
  type        = string
  default     = null
}

variable "alb_origin_host" {
  description = "DNS name CloudFront connects to for the ALB (an alias record with a regional ACM certificate on the ALB)."
  type        = string
}

variable "origin_header_name" {
  type    = string
  default = "X-Archova-Origin-Verify"
}

variable "origin_header_value" {
  description = "Secret CloudFront adds to every origin request; the ALB rejects requests without it."
  type        = string
  sensitive   = true
}

variable "static_bucket_regional_domain_name" {
  description = "S3 bucket holding /_next/static assets."
  type        = string
}

variable "waf_block" {
  description = "false = count mode (dev), true = block (staging, prod) (infrastructure/02 §3)."
  type        = bool
}

variable "rate_limit_per_ip" {
  description = "Requests per IP per 5 minutes before blocking, app distribution."
  type        = number
  default     = 3000
}

variable "api_rate_limit_per_ip" {
  description = "Requests per IP per 5 minutes, api distribution."
  type        = number
  default     = 2000
}

variable "rate_limit_per_credential" {
  description = "Requests per session cookie (app) or Authorization header (api) per 5 minutes."
  type        = number
  default     = 3000
}

variable "waf_log_bucket_arn" {
  description = "S3 bucket in Sydney named aws-waf-logs-*, so WAF logs stay in Australia (X25 residency rule extends to logs, infrastructure/01 §1)."
  type        = string
}

variable "price_class" {
  description = "PriceClass_All keeps the Australian edge locations; the others still include them but drop some regions."
  type        = string
  default     = "PriceClass_All"
}

variable "tags" {
  type    = map(string)
  default = {}
}

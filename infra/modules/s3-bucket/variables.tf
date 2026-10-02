variable "name" {
  description = "Globally unique bucket name: archova-<env>-<cell>-<purpose>-<acct6> (infrastructure/01 §8)."
  type        = string
}

variable "kms_key_arn" {
  description = "Customer-managed key for SSE-KMS. Null uses SSE-S3 (only for buckets that must be readable by services that cannot use KMS, such as ALB access logs)."
  type        = string
  default     = null
}

variable "versioning" {
  type    = bool
  default = true
}

variable "noncurrent_version_expiration_days" {
  description = "Delete previous object versions after this many days (90 for files, infrastructure/06 §2). Null keeps them."
  type        = number
  default     = 90
}

variable "expiration_days" {
  description = "Delete current objects after this many days (exports: 30). Null keeps them."
  type        = number
  default     = null
}

variable "intelligent_tiering_after_days" {
  description = "Move objects to Intelligent-Tiering after this many days (files: 30). Null disables."
  type        = number
  default     = null
}

variable "expire_prefixes" {
  description = "Prefix -> days after which objects under it are deleted (e.g. quarantine/ uploads that were never completed)."
  type        = map(number)
  default     = {}
}

variable "object_lock_enabled" {
  description = "Enable S3 Object Lock with no default retention, for per-object legal holds (the files bucket). Can only be set when the bucket is created."
  type        = bool
  default     = false
}

variable "object_lock_retention_days" {
  description = "Enable S3 Object Lock in compliance mode with this default retention (audit archive: 7 years). Null disables. Cannot be turned off later."
  type        = number
  default     = null
}

variable "cors_rules" {
  description = "CORS rules, e.g. presigned PUT from https://app.<domain>."
  type = list(object({
    allowed_methods = list(string)
    allowed_origins = list(string)
    allowed_headers = optional(list(string), [])
    expose_headers  = optional(list(string), [])
    max_age_seconds = optional(number, 3000)
  }))
  default = []
}

variable "policy_statements" {
  description = "Extra bucket policy statements (JSON documents from aws_iam_policy_document), merged with the TLS-only deny."
  type        = list(string)
  default     = []
}

variable "access_log_bucket" {
  description = "Bucket that receives server access logs. Null disables (access logs are not logged themselves)."
  type        = string
  default     = null
}

variable "force_destroy" {
  description = "Allow terraform destroy to empty the bucket. Only for dev, preview and loadtest."
  type        = bool
  default     = false
}

variable "tags" {
  type    = map(string)
  default = {}
}

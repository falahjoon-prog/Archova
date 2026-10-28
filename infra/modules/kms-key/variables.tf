variable "alias" {
  description = "Alias without the alias/ prefix, e.g. archova-prod-c1-db."
  type        = string
}

variable "description" {
  type = string
}

variable "admin_only_for_account" {
  description = "When true the account root (and so IAM policies) can manage the key but not use it; only usage_role_arns can encrypt or decrypt. Used for the BYO AI provider key (X28)."
  type        = bool
  default     = false
}

variable "usage_role_arns" {
  description = "Roles allowed to use the key for encryption and decryption."
  type        = list(string)
  default     = []
}

variable "usage_via_services" {
  description = "If set, usage_role_arns may use the key only through these services (kms:ViaService), e.g. secretsmanager.ap-southeast-2.amazonaws.com."
  type        = list(string)
  default     = []
}

variable "allow_cloudwatch_logs" {
  description = "Let CloudWatch Logs in this account and region encrypt log groups with the key."
  type        = bool
  default     = false
}

variable "service_principals" {
  description = "AWS service principals that may use the key on behalf of this account (e.g. cloudwatch.amazonaws.com and events.amazonaws.com for encrypted SNS topics)."
  type        = list(string)
  default     = []
}

variable "allow_cloudfront_distributions" {
  description = "Let CloudFront distributions in this account read objects encrypted with the key, for an S3 origin behind origin access control. The bucket policy still names the one distribution that may read."
  type        = bool
  default     = false
}

variable "multi_region" {
  description = "Create a multi-Region primary key so a replica can live in Melbourne for DR."
  type        = bool
  default     = false
}

variable "deletion_window_in_days" {
  type    = number
  default = 30
}

variable "tags" {
  type    = map(string)
  default = {}
}

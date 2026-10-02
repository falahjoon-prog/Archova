variable "name" {
  type = string
}

variable "kms_key_arn" {
  description = "Backups key in this account (local vault)."
  type        = string
}

variable "resource_arns" {
  description = "Resources to back up (Aurora cluster, Valkey queue cluster, ...)."
  type        = list(string)
}

variable "daily_retention_days" {
  type    = number
  default = 35
}

variable "monthly_retention_days" {
  description = "0 disables the monthly rule."
  type        = number
  default     = 365
}

variable "yearly_retention_days" {
  description = "0 disables the yearly rule (7 years in prod, agreed with Sam; infrastructure/06 §2)."
  type        = number
  default     = 2555
}

variable "copy_to_vault_arns" {
  description = "Vaults in the locked backup account (Sydney and Melbourne). Copies there survive a compromise of this account (infrastructure/06 §2)."
  type        = list(string)
  default     = []
}

variable "tags" {
  type    = map(string)
  default = {}
}

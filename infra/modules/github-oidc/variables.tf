variable "create_provider" {
  description = "Create the GitHub OIDC identity provider (once per account)."
  type        = bool
  default     = true
}

variable "repository" {
  description = "owner/name of the repository whose workflows may assume the roles."
  type        = string
  default     = "falahjoon-prog/Archova"
}

variable "roles" {
  description = <<-EOT
    Roles GitHub Actions may assume. subjects are the OIDC sub claims after "repo:<repository>:", e.g.
    "environment:prod" (deploys after approval) or "pull_request" (read-only plan). No long-lived keys anywhere
    (infrastructure/03 §1).
  EOT
  type = map(object({
    subjects            = list(string)
    policy_json         = optional(string)
    managed_policy_arns = optional(list(string), [])
    max_session_seconds = optional(number, 3600)
  }))
}

variable "name_prefix" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}

output "role_arns" {
  value = { for k, r in aws_iam_role.this : k => r.arn }
}

output "provider_arn" {
  value = local.provider_arn
}

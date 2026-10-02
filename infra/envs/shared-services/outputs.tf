output "state_bucket_arn" {
  value = module.state.arn
}

output "state_kms_key_arn" {
  value = aws_kms_key.state.arn
}

output "image_registry" {
  value = "${var.account_id}.dkr.ecr.ap-southeast-2.amazonaws.com"
}

output "ecr_push_role_arn" {
  description = "Set as AWS_ECR_ROLE_ARN in the repository's GitHub Actions variables."
  value       = module.github_oidc.role_arns["ecr-push"]
}

output "apex_zone_id" {
  value = var.domain == null ? null : aws_route53_zone.apex[0].zone_id
}

output "dns_prod_role_arn" {
  value = var.domain == null ? null : aws_iam_role.dns_prod[0].arn
}

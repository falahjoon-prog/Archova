output "app_distribution_arn" {
  value = aws_cloudfront_distribution.app.arn
}

output "app_distribution_domain_name" {
  value = aws_cloudfront_distribution.app.domain_name
}

output "api_distribution_arn" {
  value = aws_cloudfront_distribution.api.arn
}

output "api_distribution_domain_name" {
  value = aws_cloudfront_distribution.api.domain_name
}

output "hosted_zone_id" {
  description = "CloudFront's alias zone id for Route 53 records."
  value       = aws_cloudfront_distribution.app.hosted_zone_id
}

output "web_acl_arns" {
  value = { for k, v in aws_wafv2_web_acl.this : k => v.arn }
}

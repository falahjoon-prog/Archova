output "primary_endpoint" {
  value = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "secret_arn" {
  description = "{token, host, url}"
  value       = aws_secretsmanager_secret.this.arn
}

output "security_group_id" {
  value = aws_security_group.this.id
}

output "replication_group_id" {
  value = aws_elasticache_replication_group.this.id
}

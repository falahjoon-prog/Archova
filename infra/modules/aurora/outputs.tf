output "cluster_arn" {
  value = aws_rds_cluster.this.arn
}

output "cluster_identifier" {
  value = aws_rds_cluster.this.cluster_identifier
}

output "writer_endpoint" {
  value = aws_rds_cluster.this.endpoint
}

output "reader_endpoint" {
  value = aws_rds_cluster.this.reader_endpoint
}

output "proxy_endpoint" {
  value = var.enable_proxy ? aws_db_proxy.this[0].endpoint : null
}

output "security_group_id" {
  value = aws_security_group.db.id
}

output "master_secret_arn" {
  description = "RDS-managed master credentials, used only by the db-roles task."
  value       = aws_rds_cluster.this.master_user_secret[0].secret_arn
}

output "role_secret_arns" {
  description = "Role name -> Secrets Manager ARN ({username, password, host, port, dbname, url})."
  value       = { for r, s in aws_secretsmanager_secret.role : r => s.arn }
}

output "database_name" {
  value = aws_rds_cluster.this.database_name
}

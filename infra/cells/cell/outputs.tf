output "vpc_id" {
  value = module.network.vpc_id
}

output "egress_ips" {
  description = "NAT egress IPs to publish for customers' allow-lists."
  value       = module.network.nat_public_ips
}

output "ecs_cluster" {
  value = aws_ecs_cluster.this.name
}

output "services" {
  value = merge({ for k, s in module.service : k => s.service_name }, { worker = module.worker.service_name, "ai-worker" = module.ai_worker.service_name })
}

output "migrate_task_definition" {
  value = aws_ecs_task_definition.migrate.family
}

output "app_url" {
  value = "https://${var.app_host}"
}

output "api_url" {
  value = "https://${var.api_host}"
}

output "app_distribution_arn" {
  value = module.edge.app_distribution_arn
}

output "buckets" {
  value = {
    files         = module.files.id
    exports       = module.exports.id
    static_web    = module.static_web.id
    audit_archive = module.audit_archive.id
  }
}

output "database" {
  value = {
    writer      = module.aurora.writer_endpoint
    reader      = module.aurora.reader_endpoint
    proxy       = module.aurora.proxy_endpoint
    secrets     = module.aurora.role_secret_arns
    master      = module.aurora.master_secret_arn
    cluster_arn = module.aurora.cluster_arn
  }
}

output "alarm_topics" {
  value = {
    page   = module.observability.page_topic_arn
    ticket = module.observability.ticket_topic_arn
  }
}

output "ai_provider_secrets_key_arn" {
  value = module.kms_ai_provider_secrets.arn
}

output "github_role_arns" {
  description = "Set these as AWS_ROLE_ARN variables on the matching GitHub environments."
  value       = var.ci == null ? {} : module.github_oidc[0].role_arns
}

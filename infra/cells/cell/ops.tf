module "observability" {
  source         = "../../modules/observability"
  name           = local.name
  kms_key_arn    = module.kms_logs.arn
  alb_arn_suffix = aws_lb.this.arn_suffix

  http_services = {
    for s in keys(var.services) : s => {
      alarm_prefix          = local.svc[s]
      target_groups         = values(module.service[s].target_group_arn_suffixes)
      p95_threshold_seconds = local.service_config[s].p95_target
    }
  }

  aurora_cluster_identifier         = module.aurora.cluster_identifier
  valkey_queue_replication_group_id = module.valkey_queue.replication_group_id
  restricted_egress_metric          = module.network.restricted_egress_blocked_metric
  tags                              = local.tags
}

module "backup" {
  source                 = "../../modules/backup"
  count                  = var.backup == null ? 0 : 1
  name                   = local.name
  kms_key_arn            = module.kms_backups.arn
  resource_arns          = [module.aurora.cluster_arn]
  daily_retention_days   = var.backup.daily_retention_days
  monthly_retention_days = var.backup.monthly_retention_days
  yearly_retention_days  = var.backup.yearly_retention_days
  copy_to_vault_arns     = var.backup.copy_to_vault_arns
  tags                   = local.tags
}

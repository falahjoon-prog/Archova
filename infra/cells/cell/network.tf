module "network" {
  source                      = "../../modules/network"
  name                        = local.name
  cidr_block                  = var.vpc_cidr
  az_count                    = var.az_count
  nat_gateway_count           = var.nat_gateway_count
  firewall_endpoint_count     = var.firewall_endpoint_count
  interface_endpoint_az_count = var.interface_endpoint_az_count
  nat_eip_allocation_ids      = var.nat_eip_allocation_ids
  restricted_allowlist        = [for e in var.egress_allowlist.restricted : e.host]
  ai_vendor_denylist          = var.egress_allowlist.ai_vendor_denylist
  logs_kms_key_arn            = module.kms_logs.arn
  log_retention_days          = var.log_retention_days
  deletion_protection         = var.deletion_protection
  tags                        = local.tags
}

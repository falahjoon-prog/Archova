output "hosts" {
  description = "APP_HOST and API_HOST for host/compose.yml; point both at the NodeBalancer."
  value       = { app = local.app_host, api = local.api_host }
}

output "nodebalancer_ipv4" {
  description = "Point app. and api. (A records) here."
  value       = linode_nodebalancer.this.ipv4
}

output "nodebalancer_ipv6" {
  value = linode_nodebalancer.this.ipv6
}

output "app_servers" {
  description = "Public addresses for SSH from admin_cidrs, and VPC addresses."
  value = [for i, s in linode_instance.app : {
    label  = s.label
    public = s.ip_address
    vpc    = local.app_ips[i]
  }]
}

output "files_bucket" {
  value = { name = linode_object_storage_bucket.files.label, endpoint = "https://${linode_object_storage_bucket.files.s3_endpoint}" }
}

output "backups_bucket" {
  value = { name = linode_object_storage_bucket.backups.label, endpoint = "https://${linode_object_storage_bucket.backups.s3_endpoint}" }
}

output "roles_anywhere" {
  description = "For the signing helper on each server (host/compose.yml)."
  value = {
    trust_anchor_arn = aws_rolesanywhere_trust_anchor.linode.arn
    profile_arn      = aws_rolesanywhere_profile.linode_app.arn
    role_arn         = aws_iam_role.linode_app.arn
  }
}

# Read by the deploy pipeline to write /etc/archova/*.env on each server; never printed.
output "host_secrets" {
  sensitive = true
  value = {
    database_host       = linode_database_postgresql_v2.main.host_primary
    database_port       = linode_database_postgresql_v2.main.port
    database_admin_user = linode_database_postgresql_v2.main.root_username
    database_admin_pass = linode_database_postgresql_v2.main.root_password
    database_ca         = linode_database_postgresql_v2.main.ca_cert
    valkey_password     = random_password.valkey.result
    valkey_host         = local.app_ips[0]
    files_key_id        = linode_object_storage_key.api.access_key
    files_key_secret    = linode_object_storage_key.api.secret_key
    backup_key_id       = linode_object_storage_key.backup.access_key
    backup_key_secret   = linode_object_storage_key.backup.secret_key
  }
}

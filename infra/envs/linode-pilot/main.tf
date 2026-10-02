# Linode option for the pilots (infrastructure/09 §4): the same app on Akamai/Linode in Sydney, with off-site
# copies in Melbourne. john asked for both options coded and will pick one; nothing here runs until he does.
#
#   Internet -> NodeBalancer (TLS, Sydney) -> 2 app servers in a VPC -> managed Postgres (3 nodes, VPC only)
#                                               |-> Object Storage (uploads), Melbourne bucket (backups)
#                                               '-> Bedrock and Textract in Sydney (Roles Anywhere), SES
#
# Each app server runs the containers in host/compose.yml: Caddy, api, web, ClamAV and an allow-list DNS
# resolver; the first one also runs Valkey and the nightly backup. What replaces each AWS service is in
# docs/infrastructure/10-linode-option.md.

locals {
  name     = "archova-prod-linode"
  app_host = "app.${var.domain}"
  api_host = "api.${var.domain}"
  tags     = ["archova", "env:prod", "cell:linode"]

  vpc_cidr = "10.60.1.0/24"
  # The first app server holds Valkey; the rest reach it over the VPC.
  app_ips = [for i in range(var.app_count) : cidrhost(local.vpc_cidr, 10 + i)]
}

# --- Network -------------------------------------------------------------------------------------------------

resource "linode_vpc" "this" {
  label       = local.name
  region      = var.region
  description = "Archova pilot: app servers, NodeBalancer backends, managed Postgres"
}

resource "linode_vpc_subnet" "app" {
  vpc_id = linode_vpc.this.id
  label  = "app"
  ipv4   = local.vpc_cidr
}

# Inbound: HTTP from the NodeBalancer over the VPC and SSH from the admin addresses only. Outbound: HTTPS, DNS and
# NTP; the allow-list resolver on each server decides which HTTPS hosts the containers can find (X25).
resource "linode_firewall" "app" {
  label           = "${local.name}-app"
  inbound_policy  = "DROP"
  outbound_policy = "DROP"
  tags            = local.tags

  inbound {
    label    = "nodebalancer-http"
    action   = "ACCEPT"
    protocol = "TCP"
    ports    = "80"
    ipv4     = [local.vpc_cidr, "192.168.255.0/24"]
  }

  inbound {
    label    = "valkey-vpc"
    action   = "ACCEPT"
    protocol = "TCP"
    ports    = "6379"
    ipv4     = [local.vpc_cidr]
  }

  inbound {
    label    = "ssh-admin"
    action   = "ACCEPT"
    protocol = "TCP"
    ports    = "22"
    ipv4     = var.admin_cidrs
  }

  outbound {
    label    = "https"
    action   = "ACCEPT"
    protocol = "TCP"
    ports    = "443"
    ipv4     = ["0.0.0.0/0"]
  }

  outbound {
    label    = "dns-udp"
    action   = "ACCEPT"
    protocol = "UDP"
    ports    = "53"
    ipv4     = ["0.0.0.0/0"]
  }

  outbound {
    label    = "dns-tcp"
    action   = "ACCEPT"
    protocol = "TCP"
    ports    = "53"
    ipv4     = ["0.0.0.0/0"]
  }

  outbound {
    label    = "ntp"
    action   = "ACCEPT"
    protocol = "UDP"
    ports    = "123"
    ipv4     = ["0.0.0.0/0"]
  }

  outbound {
    label    = "vpc"
    action   = "ACCEPT"
    protocol = "TCP"
    ports    = "5432, 6379"
    ipv4     = [local.vpc_cidr]
  }
}

# --- App servers ---------------------------------------------------------------------------------------------

resource "linode_instance" "app" {
  #checkov:skip=CKV_LIN_2:authorized_keys comes from var.admin_ssh_keys, which checkov can't resolve
  count           = var.app_count
  label           = "${local.name}-app-${count.index + 1}"
  region          = var.region
  type            = var.app_type
  image           = "linode/ubuntu24.04"
  disk_encryption = "enabled"
  firewall_id     = linode_firewall.app.id
  authorized_keys = var.admin_ssh_keys # root login is off (cloud-init); this only stops Linode setting a root password login
  tags            = local.tags
  # Stateless: rebuilt from the image and host/compose.yml, so no Linode Backups (Postgres and uploads hold the data).
  backups_enabled = false

  metadata {
    user_data = base64encode(templatefile("${path.module}/cloud-init.yaml.tftpl", {
      ssh_keys = var.admin_ssh_keys
      primary  = count.index == 0
    }))
  }

  interface {
    purpose = "public"
  }

  interface {
    purpose   = "vpc"
    subnet_id = linode_vpc_subnet.app.id
    ipv4 {
      vpc = local.app_ips[count.index]
    }
  }

  alerts {
    cpu            = 180 # percent across both vCPUs
    network_in     = 50
    network_out    = 50
    transfer_quota = 80
    io             = 10000
  }

  lifecycle {
    # cloud-init only runs at first boot; later host changes go through the deploy pipeline.
    ignore_changes = [metadata]
  }
}

# --- Postgres --------------------------------------------------------------------------------------------------

# Managed Postgres 16 with daily backups and point-in-time restore (Linode's own, in Sydney); the nightly dump in
# host/backup copies it to Melbourne. Reachable only inside the VPC.
resource "linode_database_postgresql_v2" "main" {
  label        = "${local.name}-db"
  engine_id    = "postgresql/16"
  region       = var.region
  type         = var.db_type
  cluster_size = var.db_cluster_size
  allow_list   = [local.vpc_cidr]

  private_network = {
    vpc_id        = linode_vpc.this.id
    subnet_id     = linode_vpc_subnet.app.id
    public_access = false
  }

  updates = {
    day_of_week = 7 # Sunday
    duration    = 4
    frequency   = "weekly"
    hour_of_day = 16 # 2am AEST
  }

  engine_config_pg_timezone = "UTC"
}

# --- Object Storage --------------------------------------------------------------------------------------------

# Uploads (X22): quarantine/ until ClamAV clears them, then orgs/...; versioned so a deleted or overwritten file can
# be recovered for 90 days. Linode Object Storage has no Object Lock, so legal holds are an app flag here.
resource "linode_object_storage_bucket" "files" {
  label        = "${local.name}-files"
  region       = var.files_region
  versioning   = true
  acl          = "private"
  cors_enabled = true

  lifecycle_rule {
    id      = "quarantine"
    prefix  = "quarantine/"
    enabled = true
    expiration {
      days = 2
    }
  }

  lifecycle_rule {
    id                                     = "old-versions"
    enabled                                = true
    abort_incomplete_multipart_upload_days = 2
    noncurrent_version_expiration {
      days = 90
    }
  }
}

# Off-site copies in Melbourne: nightly encrypted Postgres dumps and a sync of the uploads (host/backup).
resource "linode_object_storage_bucket" "backups" {
  label      = "${local.name}-backups"
  region     = var.backup_region
  versioning = true
  acl        = "private"

  lifecycle_rule {
    id      = "dumps"
    prefix  = "postgres/"
    enabled = true
    expiration {
      days = 35
    }
  }

  lifecycle_rule {
    id      = "old-versions"
    enabled = true
    noncurrent_version_expiration {
      days = 35
    }
  }
}

# The api's key: read and write on the files bucket only.
resource "linode_object_storage_key" "api" {
  label = "${local.name}-api"
  bucket_access {
    bucket_name = linode_object_storage_bucket.files.label
    region      = var.files_region
    permissions = "read_write"
  }
}

# The backup job's key: read the files bucket, write the backups bucket. It can't delete old versions, so a
# compromised server can't erase history inside the 35-day window.
resource "linode_object_storage_key" "backup" {
  label = "${local.name}-backup"
  bucket_access {
    bucket_name = linode_object_storage_bucket.files.label
    region      = var.files_region
    permissions = "read_only"
  }
  bucket_access {
    bucket_name = linode_object_storage_bucket.backups.label
    region      = var.backup_region
    permissions = "read_write"
  }
}

# The application's database roles (tools/db/roles-lib.ts). The deploy pipeline creates them as the admin user
# before migrations run, as db-roles does on AWS; Linode's default database holds the app.
resource "random_password" "db_role" {
  for_each = toset(["app_migrator", "app_rw", "app_platform", "app_admin"])
  length   = 40
  special  = false
}

# --- Valkey ------------------------------------------------------------------------------------------------------

resource "random_password" "valkey" {
  length  = 40
  special = false
}

# --- NodeBalancer ------------------------------------------------------------------------------------------------

# Linode applies only the inbound rules of a NodeBalancer's firewall; outbound is DROP for completeness.
resource "linode_firewall" "nodebalancer" {
  label           = "${local.name}-nb"
  inbound_policy  = "DROP"
  outbound_policy = "DROP"
  tags            = local.tags

  inbound {
    label    = "web"
    action   = "ACCEPT"
    protocol = "TCP"
    ports    = "80, 443"
    ipv4     = ["0.0.0.0/0"]
    ipv6     = ["::/0"]
  }
}

resource "linode_nodebalancer" "this" {
  label                = local.name
  region               = var.region
  firewall_id          = linode_firewall.nodebalancer.id
  client_conn_throttle = 20
  tags                 = local.tags

  vpcs = [{ subnet_id = linode_vpc_subnet.app.id }]
}

# TLS ends here with TLS 1.2+ ciphers; Caddy on each server routes by path like CloudFront does on AWS.
resource "linode_nodebalancer_config" "https" {
  nodebalancer_id = linode_nodebalancer.this.id
  port            = 443
  protocol        = "https"
  ssl_cert        = var.tls_certificate
  ssl_key         = var.tls_private_key
  cipher_suite    = "recommended"
  algorithm       = "leastconn"
  check           = "http"
  check_path      = "/health/ready"
  check_interval  = 10
  check_timeout   = 5
  check_attempts  = 3
  check_passive   = true
}

# Plain HTTP only redirects to HTTPS (Caddy answers 308 when X-Forwarded-Proto is http).
resource "linode_nodebalancer_config" "http" {
  nodebalancer_id = linode_nodebalancer.this.id
  port            = 80
  protocol        = "http"
  algorithm       = "roundrobin"
  check           = "connection"
}

resource "linode_nodebalancer_node" "https" {
  count           = var.app_count
  nodebalancer_id = linode_nodebalancer.this.id
  config_id       = linode_nodebalancer_config.https.id
  label           = "app-${count.index + 1}"
  address         = "${local.app_ips[count.index]}:80"
  subnet_id       = linode_vpc_subnet.app.id
  depends_on      = [linode_instance.app]
}

resource "linode_nodebalancer_node" "http" {
  count           = var.app_count
  nodebalancer_id = linode_nodebalancer.this.id
  config_id       = linode_nodebalancer_config.http.id
  label           = "app-${count.index + 1}"
  address         = "${local.app_ips[count.index]}:80"
  subnet_id       = linode_vpc_subnet.app.id
  depends_on      = [linode_instance.app]
}

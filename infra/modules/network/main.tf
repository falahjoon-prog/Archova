# One VPC per environment (infrastructure/01 §3):
#
#   public      /22 x AZ   ALB only; routes straight to the internet gateway
#   nat         /28 x AZ   NAT gateways; return traffic to workloads goes back through the firewall
#   firewall    /28 x AZ   AWS Network Firewall endpoints
#   private     /19 x AZ   web, realtime, workers, webhook-worker
#   restricted  /21 x AZ   api, ai-worker: allow-list egress only (§3.1)
#   data        /22 x AZ   Aurora, Valkey, OpenSearch; no route out of the VPC
#
# Egress: private/restricted -> firewall endpoint (same AZ) -> NAT -> internet. The NAT sits in its own subnet
# tier, not next to the ALB, so load balancer traffic to tasks never has to cross the firewall.

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_region" "current" {}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, var.az_count)

  # Subnet plan for a /16. Index i is the AZ.
  private_cidrs    = [for i in range(var.az_count) : cidrsubnet(var.cidr_block, 3, i)]         # x.0.0/19, x.32.0/19, x.64.0/19
  restricted_cidrs = [for i in range(var.az_count) : cidrsubnet(var.cidr_block, 5, 12 + i)]    # x.96.0/21, x.104.0/21, x.112.0/21
  public_cidrs     = [for i in range(var.az_count) : cidrsubnet(var.cidr_block, 6, 32 + i)]    # x.128.0/22 ...
  data_cidrs       = [for i in range(var.az_count) : cidrsubnet(var.cidr_block, 6, 36 + i)]    # x.144.0/22 ...
  firewall_cidrs   = [for i in range(var.az_count) : cidrsubnet(var.cidr_block, 12, 4032 + i)] # x.252.0/28 ...
  nat_cidrs        = [for i in range(var.az_count) : cidrsubnet(var.cidr_block, 12, 4036 + i)] # x.252.64/28 ...

  # With fewer NATs or firewall endpoints than AZs, every AZ uses the first one.
  nat_index      = [for i in range(var.az_count) : var.nat_gateway_count >= var.az_count ? i : 0]
  firewall_index = [for i in range(var.az_count) : var.firewall_endpoint_count >= var.az_count ? i : 0]


  # AZ name -> firewall endpoint id, from the firewall's sync states.
  firewall_endpoints = {
    for s in aws_networkfirewall_firewall.this.firewall_status[0].sync_states :
    s.availability_zone => s.attachment[0].endpoint_id
  }

  tags = merge(var.tags, { "archova:component" = "network" })
}

resource "aws_vpc" "this" {
  cidr_block           = var.cidr_block
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = merge(local.tags, { Name = var.name })
}

# Nothing may use the default security group.
resource "aws_default_security_group" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.tags, { Name = "${var.name}-default-unused" })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.tags, { Name = var.name })
}

# --- Subnets -------------------------------------------------------------------------------------------------

resource "aws_subnet" "public" {
  count             = var.az_count
  vpc_id            = aws_vpc.this.id
  cidr_block        = local.public_cidrs[count.index]
  availability_zone = local.azs[count.index]
  tags              = merge(local.tags, { Name = "${var.name}-public-${local.azs[count.index]}", "archova:tier" = "public" })
}

resource "aws_subnet" "nat" {
  count             = var.az_count
  vpc_id            = aws_vpc.this.id
  cidr_block        = local.nat_cidrs[count.index]
  availability_zone = local.azs[count.index]
  tags              = merge(local.tags, { Name = "${var.name}-nat-${local.azs[count.index]}", "archova:tier" = "nat" })
}

resource "aws_subnet" "firewall" {
  count             = var.az_count
  vpc_id            = aws_vpc.this.id
  cidr_block        = local.firewall_cidrs[count.index]
  availability_zone = local.azs[count.index]
  tags              = merge(local.tags, { Name = "${var.name}-firewall-${local.azs[count.index]}", "archova:tier" = "firewall" })
}

resource "aws_subnet" "private" {
  count             = var.az_count
  vpc_id            = aws_vpc.this.id
  cidr_block        = local.private_cidrs[count.index]
  availability_zone = local.azs[count.index]
  tags              = merge(local.tags, { Name = "${var.name}-private-${local.azs[count.index]}", "archova:tier" = "private" })
}

resource "aws_subnet" "restricted" {
  count             = var.az_count
  vpc_id            = aws_vpc.this.id
  cidr_block        = local.restricted_cidrs[count.index]
  availability_zone = local.azs[count.index]
  tags              = merge(local.tags, { Name = "${var.name}-restricted-${local.azs[count.index]}", "archova:tier" = "restricted" })
}

resource "aws_subnet" "data" {
  count             = var.az_count
  vpc_id            = aws_vpc.this.id
  cidr_block        = local.data_cidrs[count.index]
  availability_zone = local.azs[count.index]
  tags              = merge(local.tags, { Name = "${var.name}-data-${local.azs[count.index]}", "archova:tier" = "data" })
}

# --- NAT -----------------------------------------------------------------------------------------------------

resource "aws_eip" "nat" {
  count  = length(var.nat_eip_allocation_ids) == 0 ? var.nat_gateway_count : 0
  domain = "vpc"
  tags   = merge(local.tags, { Name = "${var.name}-nat-${count.index}" })
}

resource "aws_nat_gateway" "this" {
  count         = var.nat_gateway_count
  subnet_id     = aws_subnet.nat[count.index].id
  allocation_id = length(var.nat_eip_allocation_ids) > 0 ? var.nat_eip_allocation_ids[count.index] : aws_eip.nat[count.index].id
  tags          = merge(local.tags, { Name = "${var.name}-nat-${local.azs[count.index]}" })

  depends_on = [aws_internet_gateway.this]

  lifecycle {
    precondition {
      condition     = length(var.nat_eip_allocation_ids) == 0 || length(var.nat_eip_allocation_ids) == var.nat_gateway_count
      error_message = "Pass one Elastic IP allocation per NAT gateway, or none."
    }
  }
}

# --- Route tables --------------------------------------------------------------------------------------------

# Public (ALB): internet gateway only.
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.tags, { Name = "${var.name}-public" })
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  count          = var.az_count
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# NAT subnets: out to the internet gateway; replies to workloads go back through the firewall endpoint of the
# workload's AZ so the stateful engine sees both directions.
resource "aws_route_table" "nat" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.tags, { Name = "${var.name}-nat" })
}

resource "aws_route" "nat_internet" {
  route_table_id         = aws_route_table.nat.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route" "nat_return_private" {
  count                  = var.az_count
  route_table_id         = aws_route_table.nat.id
  destination_cidr_block = local.private_cidrs[count.index]
  vpc_endpoint_id        = local.firewall_endpoints[local.azs[local.firewall_index[count.index]]]
}

resource "aws_route" "nat_return_restricted" {
  count                  = var.az_count
  route_table_id         = aws_route_table.nat.id
  destination_cidr_block = local.restricted_cidrs[count.index]
  vpc_endpoint_id        = local.firewall_endpoints[local.azs[local.firewall_index[count.index]]]
}

resource "aws_route_table_association" "nat" {
  count          = var.az_count
  subnet_id      = aws_subnet.nat[count.index].id
  route_table_id = aws_route_table.nat.id
}

# Firewall subnets: inspected traffic continues to a NAT gateway.
resource "aws_route_table" "firewall" {
  count  = var.az_count
  vpc_id = aws_vpc.this.id
  tags   = merge(local.tags, { Name = "${var.name}-firewall-${local.azs[count.index]}" })
}

resource "aws_route" "firewall_nat" {
  count                  = var.az_count
  route_table_id         = aws_route_table.firewall[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[local.nat_index[count.index]].id
}

resource "aws_route_table_association" "firewall" {
  count          = var.az_count
  subnet_id      = aws_subnet.firewall[count.index].id
  route_table_id = aws_route_table.firewall[count.index].id
}

# Private and restricted subnets: everything leaving the VPC goes to the firewall endpoint.
resource "aws_route_table" "private" {
  count  = var.az_count
  vpc_id = aws_vpc.this.id
  tags   = merge(local.tags, { Name = "${var.name}-private-${local.azs[count.index]}" })
}

resource "aws_route" "private_egress" {
  count                  = var.az_count
  route_table_id         = aws_route_table.private[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  vpc_endpoint_id        = local.firewall_endpoints[local.azs[local.firewall_index[count.index]]]
}

resource "aws_route_table_association" "private" {
  count          = var.az_count
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

resource "aws_route_table" "restricted" {
  count  = var.az_count
  vpc_id = aws_vpc.this.id
  tags   = merge(local.tags, { Name = "${var.name}-restricted-${local.azs[count.index]}" })
}

resource "aws_route" "restricted_egress" {
  count                  = var.az_count
  route_table_id         = aws_route_table.restricted[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  vpc_endpoint_id        = local.firewall_endpoints[local.azs[local.firewall_index[count.index]]]
}

resource "aws_route_table_association" "restricted" {
  count          = var.az_count
  subnet_id      = aws_subnet.restricted[count.index].id
  route_table_id = aws_route_table.restricted[count.index].id
}

# Data subnets: local routes only (plus the S3 gateway endpoint for Aurora exports and snapshots).
resource "aws_route_table" "data" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.tags, { Name = "${var.name}-data" })
}

resource "aws_route_table_association" "data" {
  count          = var.az_count
  subnet_id      = aws_subnet.data[count.index].id
  route_table_id = aws_route_table.data.id
}

# --- Flow logs -----------------------------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "flow" {
  name              = "/archova/${var.name}/vpc-flow"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.logs_kms_key_arn
  tags              = local.tags
}

data "aws_iam_policy_document" "flow_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["vpc-flow-logs.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "flow" {
  name               = "${var.name}-vpc-flow-logs"
  assume_role_policy = data.aws_iam_policy_document.flow_assume.json
  tags               = local.tags
}

data "aws_iam_policy_document" "flow" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
    resources = ["${aws_cloudwatch_log_group.flow.arn}:*"]
  }
}

resource "aws_iam_role_policy" "flow" {
  name   = "write-flow-logs"
  role   = aws_iam_role.flow.id
  policy = data.aws_iam_policy_document.flow.json
}

resource "aws_flow_log" "this" {
  vpc_id                   = aws_vpc.this.id
  traffic_type             = "ALL"
  log_destination_type     = "cloud-watch-logs"
  log_destination          = aws_cloudwatch_log_group.flow.arn
  iam_role_arn             = aws_iam_role.flow.arn
  max_aggregation_interval = 60
  tags                     = local.tags
}

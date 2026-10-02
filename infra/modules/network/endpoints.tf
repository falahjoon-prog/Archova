# VPC endpoints keep AWS traffic off the NAT and the firewall (infrastructure/01 §3). Bedrock and Textract are
# reached only through the Sydney endpoints, so AI calls to AWS never leave the VPC.

locals {
  bedrock_au_resources = [
    "arn:aws:bedrock:ap-southeast-2::foundation-model/*",
    "arn:aws:bedrock:ap-southeast-4::foundation-model/*",
    "arn:aws:bedrock:ap-southeast-2:*:inference-profile/au.*",
    "arn:aws:bedrock:ap-southeast-2:*:application-inference-profile/*",
    "arn:aws:bedrock:ap-southeast-2:*:guardrail/*",
  ]
}

resource "aws_vpc_endpoint" "gateway" {
  for_each          = toset(["s3", "dynamodb"])
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${data.aws_region.current.region}.${each.key}"
  vpc_endpoint_type = "Gateway"
  route_table_ids = concat(
    aws_route_table.private[*].id,
    aws_route_table.restricted[*].id,
    [aws_route_table.data.id],
  )
  tags = merge(local.tags, { Name = "${var.name}-${each.key}" })
}

resource "aws_security_group" "endpoints" {
  name        = "${var.name}-vpc-endpoints"
  description = "Interface VPC endpoints: HTTPS from inside the VPC"
  vpc_id      = aws_vpc.this.id
  tags        = merge(local.tags, { Name = "${var.name}-vpc-endpoints" })
}

resource "aws_vpc_security_group_ingress_rule" "endpoints_https" {
  security_group_id = aws_security_group.endpoints.id
  description       = "HTTPS from the VPC"
  cidr_ipv4         = var.cidr_block
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_vpc_endpoint" "interface" {
  for_each            = toset(var.interface_endpoints)
  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${data.aws_region.current.region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = slice(aws_subnet.private[*].id, 0, coalesce(var.interface_endpoint_az_count, var.az_count))
  security_group_ids  = [aws_security_group.endpoints.id]
  policy              = each.key == "bedrock-runtime" ? data.aws_iam_policy_document.bedrock_au_only.json : null
  tags                = merge(local.tags, { Name = "${var.name}-${each.key}" })
}

# Layer 2 (X25): through this endpoint, Bedrock can only run Sydney/Melbourne foundation models and the AU
# cross-region inference profile, whoever's credentials are used (ours or a customer's BYO role, X28).
data "aws_iam_policy_document" "bedrock_au_only" {
  statement {
    sid       = "AustralianModelsOnly"
    effect    = "Allow"
    actions   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:Converse", "bedrock:ConverseStream", "bedrock:ApplyGuardrail", "bedrock:CountTokens"]
    resources = local.bedrock_au_resources

    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }

  statement {
    sid           = "NothingOutsideAustralia"
    effect        = "Deny"
    actions       = ["bedrock:*"]
    not_resources = local.bedrock_au_resources

    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

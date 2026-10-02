output "vpc_id" {
  value = aws_vpc.this.id
}

output "cidr_block" {
  value = aws_vpc.this.cidr_block
}

output "azs" {
  value = local.azs
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "restricted_subnet_ids" {
  value = aws_subnet.restricted[*].id
}

output "data_subnet_ids" {
  value = aws_subnet.data[*].id
}

output "private_cidrs" {
  value = local.private_cidrs
}

output "restricted_cidrs" {
  value = local.restricted_cidrs
}

output "nat_public_ips" {
  description = "Egress IPs customers allow-list (published at /.well-known/egress-ips.json in prod)."
  value       = aws_nat_gateway.this[*].public_ip
}

output "s3_gateway_endpoint_id" {
  value = aws_vpc_endpoint.gateway["s3"].id
}

output "interface_endpoint_ids" {
  value = { for k, v in aws_vpc_endpoint.interface : k => v.id }
}

output "restricted_egress_blocked_metric" {
  description = "CloudWatch metric that counts drops from the restricted subnets."
  value = {
    namespace = "Archova/Network"
    name      = aws_cloudwatch_log_metric_filter.restricted_drops.metric_transformation[0].name
  }
}

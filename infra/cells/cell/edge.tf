module "edge" {
  source = "../../modules/cloudfront-waf"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  name                               = local.name
  app_host                           = var.app_host
  api_host                           = var.api_host
  certificate_arn                    = aws_acm_certificate_validation.cloudfront.certificate_arn
  alb_origin_host                    = local.alb_origin_host
  origin_header_name                 = local.origin_header_name
  origin_header_value                = random_password.origin_header.result
  static_bucket_regional_domain_name = module.static_web.regional_domain_name
  waf_block                          = var.waf_block
  waf_log_bucket_arn                 = module.waf_logs.arn
  tags                               = local.tags
}

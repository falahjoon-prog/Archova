provider "aws" {
  region              = "ap-southeast-2"
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = {
      env           = "staging"
      cell          = "c1"
      owner         = "owen"
      "cost-centre" = "platform"
      "managed-by"  = "terraform"
      repository    = "falahjoon-prog/Archova"
    }
  }
}

# Global control plane only: CloudFront certificates and WAF. No customer data (infrastructure/01 §1).
provider "aws" {
  alias               = "us_east_1"
  region              = "us-east-1"
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = {
      env           = "staging"
      cell          = "c1"
      owner         = "owen"
      "cost-centre" = "platform"
      "managed-by"  = "terraform"
      repository    = "falahjoon-prog/Archova"
    }
  }
}

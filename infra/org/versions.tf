terraform {
  required_version = ">= 1.11.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.14, < 7.0"
    }
  }

  # Applied manually by Jeff with a second reviewer, from the management account (infrastructure/03 §7).
  backend "s3" {
    key          = "org/org.tfstate"
    region       = "ap-southeast-2"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region              = "ap-southeast-2"
  allowed_account_ids = [var.management_account_id]
}

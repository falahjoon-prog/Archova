terraform {
  required_version = ">= 1.11.0"

  required_providers {
    linode = {
      source  = "linode/linode"
      version = ">= 4.7, < 5.0"
    }
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.14, < 7.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6, < 4.0"
    }
  }

  # State goes in the Melbourne state bucket on Linode Object Storage (S3-compatible), created by hand once
  # (docs/infrastructure/10-linode-option.md, step 2): terraform init -backend-config=backend.hcl
  backend "s3" {
    key                         = "envs/linode-pilot.tfstate"
    region                      = "au-mel"
    encrypt                     = true
    use_lockfile                = true
    use_path_style              = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }
}

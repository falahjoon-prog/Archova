terraform {
  required_version = ">= 1.11.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.14, < 7.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6, < 4.0"
    }
  }

  # State lives in the shared-services account (infrastructure/01 §7). The bucket comes from backend.hcl, written
  # once shared-services exists: terraform init -backend-config=../backend.hcl
  backend "s3" {
    key          = "envs/staging/c1.tfstate"
    region       = "ap-southeast-2"
    encrypt      = true
    use_lockfile = true
  }
}

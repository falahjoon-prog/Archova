terraform {
  required_version = ">= 1.11.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 6.14, < 7.0"
    }
  }

  # This stack creates the state bucket every other stack uses. First apply runs with local state
  # (terraform init -backend=false), then `terraform init -migrate-state -backend-config=../backend.hcl` moves the
  # state into the bucket it just made (infra/README.md "First-time setup").
  backend "s3" {
    key          = "envs/shared-services/shared.tfstate"
    region       = "ap-southeast-2"
    encrypt      = true
    use_lockfile = true
  }
}

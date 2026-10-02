provider "aws" {
  region              = "ap-southeast-2"
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = {
      env           = "shared"
      cell          = "shared"
      owner         = "owen"
      "cost-centre" = "platform"
      "managed-by"  = "terraform"
      repository    = "falahjoon-prog/Archova"
    }
  }
}

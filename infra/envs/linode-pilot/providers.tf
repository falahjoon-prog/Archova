# The token comes from LINODE_TOKEN (a personal access token scoped to Linodes, VPCs, NodeBalancers, Firewalls,
# Databases and Object Storage). Nothing here runs until john picks the Linode option and a token exists.
provider "linode" {}

# The archova-prod AWS account: only for Nova (Bedrock and Textract in Sydney, X25) and email (SES), reached from
# the Linode servers with IAM Roles Anywhere certificates instead of long-lived keys.
provider "aws" {
  region              = "ap-southeast-2"
  allowed_account_ids = [var.aws_account_id]

  default_tags {
    tags = {
      env           = "prod"
      cell          = "linode"
      owner         = "jeff"
      "cost-centre" = "ai"
      "managed-by"  = "terraform"
      repository    = "falahjoon-prog/Archova"
    }
  }
}

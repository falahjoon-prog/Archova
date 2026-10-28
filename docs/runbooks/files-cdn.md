# Drawing tiles CDN

Owner: Jeff. Backend: `modules/files` `tile-urls.ts` (Ben). Terraform: `infra/cells/cell/files-cdn.tf`. Off until a cell sets `files_cdn`.

## What it is

A CloudFront distribution in front of the files bucket. The api signs one URL template per drawing revision (`API_FILES_CDN_DOMAIN`, `API_FILES_CDN_KEY_PAIR_ID`, `API_FILES_CDN_PRIVATE_KEY`), valid 6 hours, and phones fill `{z}/{x}/{y}.webp` themselves.

- Only signed requests are served. A signature covers one drawing's tile prefix.
- The bucket policy lets only this distribution read `orgs/*/projects/*/tiles/*`. **A tile prefix must contain `/tiles/`**, or the CDN cannot read it.
- Viewers are limited to Australia by default (`allowed_countries`), so tiles are cached at Australian edges only. Price class is "all" because Australian edges are not in the cheaper classes. This needs Sam's and john's sign-off before it is switched on.
- No access logging, because a standard CloudFront log line contains the signed query string. If logs are ever turned on, strip `Policy`, `Signature` and `Key-Pair-Id` before they are stored.
- The key policy on the files key lets CloudFront in this account decrypt for origin access control. The bucket policy names the one distribution that may read.

## Turn it on or rotate the key

1. Generate the key pair somewhere safe (not in the repo): `openssl genrsa -out tiles.pem 2048 && openssl rsa -in tiles.pem -pubout -out tiles.pub`.
2. Put the public key in the cell's `files_cdn = { public_key_pem = file("tiles.pub") }` and apply (plan reviewed first).
3. Put the private key in the secret named by the `files_cdn` output: `aws secretsmanager put-secret-value --secret-id <private_key_id> --secret-string file://tiles.pem`.
4. Roll the api so it reads the new secret: `aws ecs update-service --force-new-deployment` on the api service.
5. Delete `tiles.pem` and `tiles.pub` from the machine.

Rotation: add a second public key to the key group first, switch the secret and the key pair id, then remove the old key after 6 hours (the longest a signed template lives).

## Not done yet

A custom domain (`files.<domain>`) for the distribution, which also gives a minimum TLS version. Until then the api uses the `*.cloudfront.net` name.

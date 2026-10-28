# Linode option: restore from backup

**Owner:** Jeff · **Applies to:** `infra/envs/linode-pilot` · **Last tested:** not yet (run the test restore below before any pilot data goes in)

What is backed up (infrastructure/10 §Backups):

| Data | Where | Kept |
|---|---|---|
| Postgres, whole database | Linode's own daily backups and point-in-time restore, Sydney | Linode's retention |
| Postgres, nightly `pg_dump`, encrypted with `age` | Melbourne backups bucket, `postgres/<stamp>.dump.age` | 35 days |
| Uploads | Sydney files bucket (versioned, old versions 90 days), plus an rclone copy in the Melbourne backups bucket under `files/` | 35 days of versions in Melbourne |

You need: the `age` private key from the password manager (without it no dump can be read), a Linode token, and the backups bucket key (Terraform output `host_secrets`, `backup_key_id` and `backup_key_secret`).

## 1. Test restore to Melbourne (do this once, then each quarter)

This proves the dump is readable and the app's schema comes back, without touching production.

1. Pick the newest dump:
   ```
   export RCLONE_CONFIG_B_TYPE=s3 RCLONE_CONFIG_B_PROVIDER=Linode RCLONE_CONFIG_B_ENDPOINT=https://au-mel-1.linodeobjects.com \
     RCLONE_CONFIG_B_ACCESS_KEY_ID=<backup_key_id> RCLONE_CONFIG_B_SECRET_ACCESS_KEY=<backup_key_secret>
   rclone lsl b:archova-prod-linode-backups/postgres | sort -k2,3 | tail -3
   rclone copyto b:archova-prod-linode-backups/postgres/<stamp>.dump.age ./restore.dump.age
   ```
2. Decrypt: `age --decrypt -i age.key restore.dump.age > restore.dump`.
3. Create a throwaway Postgres 16 with pgvector in Melbourne (smallest managed database in `au-mel`, or a Docker `pgvector/pgvector:pg16` on a laptop for the first test).
4. Restore: `createdb restore_test && pg_restore --no-owner --no-privileges --dbname restore_test restore.dump`.
5. Check: `psql restore_test -c "select count(*) from platform.orgs"` and the same count in production; `pnpm db:lint` against it must pass (RLS on every tenant table).
6. Delete the throwaway database and `restore.dump`. Write the date and the dump stamp at the top of this file.

## 2. Whole database lost or corrupted, Sydney still up

1. Stop writes: on both servers `docker compose --profile "$(cat /etc/archova/role)" stop api`.
2. Prefer Linode's point-in-time restore (Cloud Manager, Databases, the cluster, Backups) to a new cluster at the time just before the damage. Point `database_host` at the new cluster (`terraform output` after re-importing, or edit state with john) and redeploy so the env files are rewritten.
3. If Linode's backup is also unusable, restore the newest dump into a new cluster as in step 1.3 to 1.4, run the migrations (deploy workflow), then redeploy.
4. Start the api, check `/health/ready`, and tell Grace if tenant data was lost (the notifiable-breach clock may start).

## 3. A file was deleted or overwritten

The files bucket is versioned: `aws s3api list-object-versions --bucket <files bucket> --prefix <key> --endpoint-url <endpoint>` shows the old version; copy it back with `aws s3api copy-object --copy-source "<bucket>/<key>?versionId=<id>"`. If the bucket itself is lost, `rclone sync b:archova-prod-linode-backups/files <new bucket>` (the Melbourne copy).

## 4. Sydney lost (Linode region outage)

Recovery objective is the AWS pilot's phase 0 to 2 target: up to 24 hours. Create the same stack in Melbourne with `region = "au-mel"` in `terraform.tfvars` (a separate state key), restore the newest dump as in step 1, set the `files` bucket from the Melbourne copy, then point `app.` and `api.` at the new NodeBalancer. Nothing here is automatic. Rehearse it before any claim data is held.

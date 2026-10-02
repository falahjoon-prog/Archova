#!/bin/bash
# Off-site copy for the Linode option (infrastructure/10 §Backups). Linode's managed Postgres already keeps daily
# backups and point-in-time restore in Sydney; this adds a copy in Melbourne that a Sydney outage can't take out.
#   1. pg_dump of the whole database, encrypted with age to the offline recovery key (only its public half is
#      here), uploaded to backups/postgres/<date>.dump.age; kept 35 days by the bucket lifecycle.
#   2. rclone sync of the uploads bucket to backups/files/; the backups bucket is versioned, so files deleted in
#      Sydney stay recoverable for 35 days.
# On failure it exits non-zero and pings BACKUP_ALERT_URL/fail (Better Stack heartbeat), which alerts Jeff.
set -eu -o pipefail

: "${PGHOST:?}" "${PGUSER:?}" "${PGPASSWORD:?}" "${PGDATABASE:?}" "${AGE_RECIPIENT:?}"
: "${FILES_ENDPOINT:?}" "${FILES_BUCKET:?}" "${FILES_KEY_ID:?}" "${FILES_KEY_SECRET:?}"
: "${BACKUP_ENDPOINT:?}" "${BACKUP_BUCKET:?}" "${BACKUP_KEY_ID:?}" "${BACKUP_KEY_SECRET:?}"
export PGSSLMODE=verify-full PGSSLROOTCERT=/etc/ssl/db-ca.pem PGPORT="${PGPORT:-5432}"

ping_monitor() {
  if [ -n "${BACKUP_ALERT_URL:-}" ]; then
    wget -q -O /dev/null "$BACKUP_ALERT_URL$1" || true
  fi
}

fail() {
  ping_monitor /fail
  echo "backup failed: $1" >&2
  exit 1
}

export RCLONE_CONFIG_SRC_TYPE=s3 RCLONE_CONFIG_SRC_PROVIDER=Linode RCLONE_CONFIG_SRC_ENDPOINT="$FILES_ENDPOINT" \
  RCLONE_CONFIG_SRC_ACCESS_KEY_ID="$FILES_KEY_ID" RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY="$FILES_KEY_SECRET"
export RCLONE_CONFIG_DST_TYPE=s3 RCLONE_CONFIG_DST_PROVIDER=Linode RCLONE_CONFIG_DST_ENDPOINT="$BACKUP_ENDPOINT" \
  RCLONE_CONFIG_DST_ACCESS_KEY_ID="$BACKUP_KEY_ID" RCLONE_CONFIG_DST_SECRET_ACCESS_KEY="$BACKUP_KEY_SECRET"

stamp=$(date -u +%Y-%m-%dT%H%MZ)
echo "postgres dump $stamp"
pg_dump --format=custom --no-owner --no-privileges \
  | age --encrypt --recipient "$AGE_RECIPIENT" \
  | rclone rcat "dst:$BACKUP_BUCKET/postgres/$stamp.dump.age" || fail "postgres dump"

echo "uploads sync"
rclone sync "src:$FILES_BUCKET" "dst:$BACKUP_BUCKET/files" --fast-list --checksum --transfers 8 || fail "uploads sync"

ping_monitor ""
echo "backup done $stamp"

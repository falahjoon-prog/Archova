#!/usr/bin/env bash
# Deploys one release to the Linode option's app servers (infrastructure/10), the counterpart of deploy.sh on AWS.
# Runs in GitHub Actions (.github/workflows/linode-deploy.yml) with the images already saved to images.tar.gz:
#   1. opens SSH on the app firewall to this runner's address only, and closes it again on exit
#   2. on the primary: copies the host bundle and its files, loads the images, starts Valkey, then runs the
#      database roles and migrations; either failing stops the deploy before any app container changes
#   3. one server at a time, primary first: restarts the containers and waits for them to be healthy, then checks
#      the api through Caddy on that server before moving on, so the NodeBalancer always has a healthy server
#   4. smoke-tests the public hosts
#
# Usage: linode-deploy.sh <outputs.json> <image tag> <images.tar.gz>
# Env: LINODE_TOKEN (firewall read/write), LINODE_JWT_PRIVATE_JWK, SSH_KNOWN_HOSTS, optional BACKUP_ALERT_URL;
#      the deploy user's SSH key loaded in ssh-agent.
set -euo pipefail

OUTPUTS=$1 TAG=$2 IMAGES=$3
: "${LINODE_TOKEN:?}" "${LINODE_JWT_PRIVATE_JWK:?}" "${SSH_KNOWN_HOSTS:?}"
HOST_BUNDLE=infra/envs/linode-pilot/host
WORK=$(mktemp -d)
LINODE_API=https://api.linode.com/v4

out() { jq -r "$1" "$OUTPUTS"; }
FIREWALL=$(out .deploy.value.app_firewall_id)
APP_HOST=$(out .hosts.value.app)
API_HOST=$(out .hosts.value.api)
SERVER_COUNT=$(out '.app_servers.value | length')
RULE_LABEL="gha-deploy-${GITHUB_RUN_ID:-local}"

printf '%s\n' "$SSH_KNOWN_HOSTS" > "$WORK/known_hosts"
SSH_OPTS=(-o BatchMode=yes -o UserKnownHostsFile="$WORK/known_hosts" -o StrictHostKeyChecking=yes -o ConnectTimeout=20)

linode() {
  curl -fsS -H "Authorization: Bearer $LINODE_TOKEN" -H 'Content-Type: application/json' "$@"
}

# Adds or removes this runner's SSH rule. The other rules are sent back unchanged.
firewall() {
  local rules
  rules=$(linode "$LINODE_API/networking/firewalls/$FIREWALL/rules")
  if [ "$1" = open ]; then
    rules=$(jq --arg label "$RULE_LABEL" --arg ip "$RUNNER_IP/32" \
      '.inbound += [{label: $label, action: "ACCEPT", protocol: "TCP", ports: "22", addresses: {ipv4: [$ip]}}]' \
      <<<"$rules")
  else
    rules=$(jq --arg label "$RULE_LABEL" '.inbound |= map(select(.label != $label))' <<<"$rules")
  fi
  jq '{inbound, inbound_policy, outbound, outbound_policy}' <<<"$rules" \
    | linode -X PUT -d @- "$LINODE_API/networking/firewalls/$FIREWALL/rules" > /dev/null
}

cleanup() {
  firewall close || echo "::warning::Could not remove firewall rule $RULE_LABEL; remove it in Cloud Manager"
  rm -rf "$WORK"
}

RUNNER_IP=$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')
firewall open
trap cleanup EXIT
sleep 10 # Cloud Firewall changes take a few seconds to apply

# Runs a command as deploy on the server at $1. The commands are built here, so they expand on this side on purpose.
on() {
  local ip=$1
  shift
  # shellcheck disable=SC2029
  ssh "${SSH_OPTS[@]}" "deploy@$ip" "$@"
}

# Copies the bundle, the rendered files and the images to server $1 (index) at $2 (address).
push() {
  local i=$1 ip=$2 files="$WORK/server-$1"
  echo "::group::server $((i + 1)): copy files and load images"
  pnpm -s infra:linode-host-files "$OUTPUTS" "$i" "$TAG" "$files"
  on "$ip" 'test -s /etc/archova/pki/app.crt && test -s /etc/archova/pki/app.key' \
    || { echo "::error::server $((i + 1)) has no client certificate in /etc/archova/pki (docs/infrastructure/10 step 3)"; exit 1; }
  tar -C "$HOST_BUNDLE" -czf - . | on "$ip" 'tar -xzf - -C /opt/archova'
  tar -C "$files/opt" -cf - .env | on "$ip" 'tar -xf - -C /opt/archova'
  tar -C "$files/etc" -cf - . | on "$ip" 'umask 077 && tar -xf - --no-same-owner -C /etc/archova'
  on "$ip" 'docker load -q' < "$IMAGES"
  echo "::endgroup::"
}

compose() {
  local ip=$1
  shift
  on "$ip" "cd /opt/archova && docker compose --profile \"\$(cat /etc/archova/role)\" $*"
}

# Restarts server $1's containers on the new images and waits until they're healthy, then checks the api
# through Caddy the way the NodeBalancer does.
roll() {
  local i=$1 ip=$2 vpc
  vpc=$(out ".app_servers.value[$i].vpc")
  echo "::group::server $((i + 1)): restart"
  compose "$ip" up -d --no-build --remove-orphans --wait --wait-timeout 300
  on "$ip" "curl -fsS --retry 10 --retry-delay 3 --retry-all-errors -o /dev/null -H 'Host: $API_HOST' http://$vpc/health/ready"
  on "$ip" 'docker image prune -f > /dev/null'
  echo "::endgroup::"
  echo "server $((i + 1)): deployed $TAG"
}

PRIMARY=$(out '.app_servers.value[0].public')
push 0 "$PRIMARY"
echo "::group::database roles and migrations"
compose "$PRIMARY" up -d --no-build --wait coredns valkey
on "$PRIMARY" 'cd /opt/archova && docker compose --profile tools run --rm --no-deps db-roles'
on "$PRIMARY" 'cd /opt/archova && docker compose --profile tools run --rm --no-deps migrate'
echo "::endgroup::"
roll 0 "$PRIMARY"

for ((i = 1; i < SERVER_COUNT; i++)); do
  ip=$(out ".app_servers.value[$i].public")
  push "$i" "$ip"
  roll "$i" "$ip"
done

curl -fsS -o /dev/null --retry 5 --retry-delay 10 --retry-all-errors "https://${API_HOST}/health/ready"
curl -fsS -o /dev/null --retry 5 --retry-delay 10 --retry-all-errors "https://${APP_HOST}/login"
echo "Deployed $TAG to $SERVER_COUNT servers"

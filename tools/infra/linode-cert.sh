#!/usr/bin/env bash
# Renews the Linode option's TLS certificate (infrastructure/10 §Certificate renewal): Let's Encrypt through DNS-01
# in Linode DNS (lego), then puts the new certificate on the NodeBalancer's HTTPS config through the Linode API.
# Skips when the live certificate has more than RENEW_DAYS left, unless FORCE=true. One certificate covers app. and api.
#
# Usage: linode-cert.sh <outputs.json>
# Env: LINODE_CERT_TOKEN (Domains and NodeBalancers read/write), ACME_EMAIL, optional FORCE, RENEW_DAYS (default 30),
#      CERT_ALERT_URL (a heartbeat pinged on success and at /fail on failure).
set -euo pipefail

OUTPUTS=$1
: "${LINODE_CERT_TOKEN:?}" "${ACME_EMAIL:?}"
RENEW_DAYS=${RENEW_DAYS:-30}
WORK=$(mktemp -d)
LINODE_API=https://api.linode.com/v4

out() { jq -r "$1" "$OUTPUTS"; }
APP_HOST=$(out .hosts.value.app)
API_HOST=$(out .hosts.value.api)
NB=$(out .deploy.value.nodebalancer_id)
CFG=$(out .deploy.value.https_config_id)

ping_monitor() {
  if [ -n "${CERT_ALERT_URL:-}" ]; then curl -fsS -m 10 -o /dev/null "$CERT_ALERT_URL$1" || true; fi
}
fail() {
  ping_monitor /fail
  echo "::error::certificate renewal failed: $1"
  exit 1
}
trap 'rm -rf "$WORK"' EXIT

# Seconds the certificate served on $1:443 has left (a hostname that is not up yet counts as expired).
seconds_left() {
  local end
  end=$(echo | openssl s_client -connect "$1:443" -servername "$1" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null) || { echo 0; return; }
  [ -n "$end" ] || { echo 0; return; }
  echo $(($(date -d "${end#notAfter=}" +%s) - $(date +%s)))
}

left=$(seconds_left "$API_HOST")
if [ "${FORCE:-false}" != true ] && [ "$left" -gt $((RENEW_DAYS * 86400)) ]; then
  echo "Certificate on $API_HOST has $((left / 86400)) days left; nothing to do"
  ping_monitor ""
  exit 0
fi

echo "Issuing a certificate for $APP_HOST and $API_HOST"
docker run --rm -e LINODE_TOKEN="$LINODE_CERT_TOKEN" -e LINODE_PROPAGATION_TIMEOUT=600 -v "$WORK:/.lego" \
  goacme/lego:v4.25.2 --accepted-tos --email "$ACME_EMAIL" --dns linode --dns.propagation-wait 60s \
  --domains "$APP_HOST" --domains "$API_HOST" run || fail "lego could not issue the certificate"
# lego writes the files as root, named after the first domain.
sudo chown -R "$(id -u)" "$WORK"
CRT="$WORK/certificates/$APP_HOST.crt" KEY="$WORK/certificates/$APP_HOST.key"
[ -s "$CRT" ] && [ -s "$KEY" ] || fail "lego wrote no certificate"
openssl x509 -in "$CRT" -noout -checkend $((60 * 86400)) || fail "the new certificate expires within 60 days"

jq -n --rawfile cert "$CRT" --rawfile key "$KEY" '{ssl_cert: $cert, ssl_key: $key}' \
  | curl -fsS -X PUT -H "Authorization: Bearer $LINODE_CERT_TOKEN" -H 'Content-Type: application/json' -d @- \
      "$LINODE_API/nodebalancers/$NB/configs/$CFG" > /dev/null || fail "the NodeBalancer rejected the certificate"

# The NodeBalancer picks the new certificate up within seconds.
for _ in 1 2 3 4 5 6; do
  [ "$(seconds_left "$API_HOST")" -gt $((60 * 86400)) ] && { echo "Renewed: $API_HOST now has a fresh certificate"; ping_monitor ""; exit 0; }
  sleep 10
done
fail "the NodeBalancer still serves the old certificate"

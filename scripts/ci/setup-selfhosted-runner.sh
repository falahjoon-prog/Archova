#!/usr/bin/env bash
# Installs N self-hosted GitHub Actions runners for this repo on a Linux box (Ubuntu in WSL2 on the Windows PC works).
# Why Linux: ci.yml runs Postgres/Valkey as service containers, which only work on Linux runners.
#
# Usage (token from repo Settings > Actions > Runners > New self-hosted runner, valid 1 hour):
#   RUNNER_TOKEN=<token> ./setup-selfhosted-runner.sh [count=4]
# Runner 1 also gets the "integration" label (it is the only one that runs the fixed-port Postgres job).
# Afterwards set repo variables (Settings > Secrets and variables > Actions > Variables):
#   CI_RUNNER             ["self-hosted","archova"]
#   CI_RUNNER_INTEGRATION ["self-hosted","archova","integration"]
# Delete the variables to fall back to GitHub-hosted runners. Private repo only: never point a public repo's
# pull requests at a self-hosted runner.
set -euo pipefail
REPO_URL="${REPO_URL:-https://github.com/falahjoon-prog/archova}"
COUNT="${1:-4}"
VERSION="${RUNNER_VERSION:-2.329.0}"
: "${RUNNER_TOKEN:?set RUNNER_TOKEN}"
[ "$(id -u)" -ne 0 ] || { echo "Run as a normal user, not root"; exit 1; }

sudo apt-get update -y
sudo apt-get install -y curl git build-essential python3 unzip jq ca-certificates docker.io
sudo usermod -aG docker "$USER"
command -v systemctl >/dev/null && sudo systemctl enable --now docker || sudo service docker start

mkdir -p "$HOME/actions-runners" && cd "$HOME/actions-runners"
[ -f "runner-$VERSION.tgz" ] || curl -fsSL -o "runner-$VERSION.tgz" \
  "https://github.com/actions/runner/releases/download/v$VERSION/actions-runner-linux-x64-$VERSION.tar.gz"

for i in $(seq 1 "$COUNT"); do
  dir="archova-$i"; mkdir -p "$dir"; cd "$dir"
  [ -f config.sh ] || tar xzf "../runner-$VERSION.tgz"
  labels="archova"; [ "$i" -eq 1 ] && labels="archova,integration"
  ./config.sh --unattended --replace --url "$REPO_URL" --token "$RUNNER_TOKEN" \
    --name "$(hostname)-$i" --labels "$labels" --work _work
  sudo ./svc.sh install "$USER" && sudo ./svc.sh start || echo "No systemd: start with 'nohup ./run.sh &' in $dir"
  cd ..
done
echo "Done. Check Settings > Actions > Runners shows $COUNT idle runners, then set the repo variables."

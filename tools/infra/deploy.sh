#!/usr/bin/env bash
# Deploys one image tag to one environment (infrastructure/03 §4, §5). Runs in GitHub Actions as the environment's
# deploy role (infra/cells/cell/ci-roles.tf):
#   1. registers new task definition revisions that point at the tag (ECS pins the digest when tasks start)
#   2. runs db-roles, then migrations, as one-off tasks; either failing stops the deploy before any traffic moves
#   3. updates api and web (ECS blue/green shifts traffic and rolls back on its alarms) and the workers (rolling)
#   4. smoke-tests the public hosts
#
# Usage: deploy.sh <env> <registry> <tag>    e.g. deploy.sh demo 123456789012.dkr.ecr.ap-southeast-2.amazonaws.com 3f2c1ab
set -euo pipefail

ENV=$1 REGISTRY=$2 TAG=$3
CELL=${CELL:-c1}
NAME="archova-${ENV}-${CELL}"
PARAM="/archova/${ENV}/${CELL}"
TIMEOUT_MINUTES=${TIMEOUT_MINUTES:-75}

param() { aws ssm get-parameter --name "${PARAM}/$1" --query Parameter.Value --output text; }
CLUSTER=$(param ecs-cluster)
SUBNETS=$(param private-subnets | jq -r 'join(",")')
TASK_SG=$(param migrate-sg)
APP_HOST=$(param app-host)
API_HOST=$(param api-host)

# Registers a new revision of a task definition family with its (single) container on $1's image; prints the ARN.
new_revision() {
  local family=$1 image=$2
  aws ecs describe-task-definition --task-definition "$family" --query taskDefinition \
    | jq --arg image "$image" '
        .containerDefinitions[0].image = $image
        | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities,
              .registeredAt, .registeredBy, .deregisteredAt)' > /tmp/taskdef.json
  aws ecs register-task-definition --cli-input-json file:///tmp/taskdef.json \
    --query taskDefinition.taskDefinitionArn --output text
}

# Runs a one-off task to completion; fails unless its container exits 0.
run_task() {
  local name=$1 taskdef=$2 arn code
  echo "::group::$name"
  arn=$(aws ecs run-task --cluster "$CLUSTER" --task-definition "$taskdef" --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$TASK_SG],assignPublicIp=DISABLED}" \
    --started-by "deploy-${TAG:0:20}" --query 'tasks[0].taskArn' --output text)
  echo "task $arn"
  aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$arn"
  code=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$arn" --query 'tasks[0].containers[0].exitCode' --output text)
  aws logs filter-log-events --log-group-name "/archova/${NAME}-migrate" \
    --log-stream-name-prefix "${name}/" --start-time $(( ($(date +%s) - 1800) * 1000 )) \
    --query 'events[].message' --output text | tr '\t' '\n' | tail -50 || true
  echo "::endgroup::"
  if [ "$code" != "0" ]; then
    echo "::error::$name exited with $code"
    exit 1
  fi
}

# Waits for a service's newest deployment to finish; fails if ECS rolled it back.
wait_service() {
  local service=$1 deadline=$(( $(date +%s) + TIMEOUT_MINUTES * 60 )) state
  while true; do
    # shellcheck disable=SC2016 # backticks are a JMESPath literal, not a shell expansion
    state=$(aws ecs describe-services --cluster "$CLUSTER" --services "$service" \
      --query 'services[0].deployments[?status==`PRIMARY`].rolloutState | [0]' --output text)
    case "$state" in
      COMPLETED) echo "$service: deployed"; return 0 ;;
      FAILED) echo "::error::$service: deployment failed and was rolled back"; exit 1 ;;
    esac
    if [ "$(date +%s)" -gt "$deadline" ]; then
      echo "::error::$service: still $state after $TIMEOUT_MINUTES minutes"
      exit 1
    fi
    sleep 30
  done
}

run_task db-roles "$(new_revision "${NAME}-db-roles" "${REGISTRY}/archova/migrate:${TAG}")"
run_task migrate "$(new_revision "${NAME}-migrate" "${REGISTRY}/archova/migrate:${TAG}")"

for svc in api web worker ai-worker; do
  current=$(aws ecs describe-services --cluster "$CLUSTER" --services "${NAME}-${svc}" \
    --query 'services[0].taskDefinition' --output text)
  family=$(echo "$current" | sed -E 's|.*task-definition/([^:]+):.*|\1|')
  td=$(new_revision "$family" "${REGISTRY}/archova/${svc}:${TAG}")
  aws ecs update-service --cluster "$CLUSTER" --service "${NAME}-${svc}" --task-definition "$td" >/dev/null
  echo "${NAME}-${svc} -> $td"
done
for svc in api web worker ai-worker; do wait_service "${NAME}-${svc}"; done

curl -fsS -o /dev/null --retry 5 --retry-delay 10 --retry-all-errors "https://${APP_HOST}/login"
curl -fsS -o /dev/null --retry 5 --retry-delay 10 --retry-all-errors "https://${API_HOST}/.well-known/jwks.json"
echo "Smoke tests passed: https://${APP_HOST}"

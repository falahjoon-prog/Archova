# Nightly off-site backup for the Linode option (backup.sh). Alpine 3.22 ships bash, postgresql16-client, age and rclone.
FROM alpine:3.22
# Alpine's repositories keep only the current package versions, so pins would break rebuilds; the image is rebuilt
# on every deploy instead.
# hadolint ignore=DL3018
RUN apk add --no-cache bash postgresql16-client age rclone ca-certificates tzdata supercronic
COPY --chmod=0755 backup.sh /usr/local/bin/backup.sh
COPY crontab /etc/crontab
USER 65532:65532
ENV TZ=Australia/Sydney
ENTRYPOINT ["supercronic", "-passthrough-logs", "/etc/crontab"]

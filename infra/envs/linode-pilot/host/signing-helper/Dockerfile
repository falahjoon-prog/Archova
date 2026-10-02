# AWS IAM Roles Anywhere credential helper (aws.tf). Linode's shared CPU plans are x86_64. The binary needs glibc
# and CA certificates only, which distroless base has.
FROM gcr.io/distroless/base-debian12:nonroot
ARG VERSION=1.7.0
ARG SHA256=e932f029b73f97523c1dea2e78e9543d9e2753c387c4c46e77be8c1d9424db0f
ADD --checksum=sha256:${SHA256} --chmod=0755 \
    https://rolesanywhere.amazonaws.com/releases/${VERSION}/X86_64/Linux/aws_signing_helper /usr/local/bin/aws_signing_helper
ENTRYPOINT ["/usr/local/bin/aws_signing_helper"]

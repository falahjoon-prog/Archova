// The CORS rules for the Linode option's uploads bucket, the same as the files bucket on AWS (infra/cells/cell/storage.tf):
// browsers PUT uploads straight to a presigned URL, and pdf.js reads PDFs from the presigned download URL in byte ranges.
// The Terraform provider can only switch CORS on, not set rules, so the deploy workflow applies this with the S3 API.
//
// pnpm infra:linode-cors <outputs.json>   prints the rules as JSON for `aws s3api put-bucket-cors --cors-configuration`
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface CorsRule {
  AllowedMethods: string[];
  AllowedOrigins: string[];
  AllowedHeaders: string[];
  ExposeHeaders: string[];
  MaxAgeSeconds?: number;
}

export function corsRules(appHost: string): { CORSRules: CorsRule[] } {
  if (!/^[a-z0-9.-]+$/.test(appHost)) throw new Error(`Not a host name: ${appHost}`);
  const origin = `https://${appHost}`;
  return {
    CORSRules: [
      {
        AllowedMethods: ['PUT'],
        AllowedOrigins: [origin],
        AllowedHeaders: ['content-type', 'x-amz-checksum-sha256'],
        ExposeHeaders: ['etag'],
        MaxAgeSeconds: 3600,
      },
      {
        AllowedMethods: ['GET', 'HEAD'],
        AllowedOrigins: [origin],
        AllowedHeaders: ['range'],
        ExposeHeaders: ['accept-ranges', 'content-length', 'content-range', 'etag'],
        MaxAgeSeconds: 3600,
      },
    ],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: linode-cors <outputs.json>');
  const outputs = JSON.parse(readFileSync(file, 'utf8')) as { hosts: { value: { app: string } } };
  console.log(JSON.stringify(corsRules(outputs.hosts.value.app), null, 2));
}

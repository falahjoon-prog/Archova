import { createDatabase, createLogger, createRedis } from '@archova/kernel';
import {
  createClamAvScanner,
  createGuardDutyScanner,
  createMemoryObjectStore,
  createS3ObjectStore,
  noScanner,
} from '@archova/mod-files';
import { buildApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const logger = createLogger('api', config.logLevel);
const database = createDatabase(config.databaseUrl, { max: config.databasePoolMax });
const redis = config.redisUrl ? createRedis(config.redisUrl) : null;
if (!redis)
  logger.warn(
    'API_REDIS_URL not set: sessions are read from Postgres and Idempotency-Key is ignored',
  );
if (config.files.store === 'memory')
  logger.warn('API_FILES_STORE=memory: uploads are kept in process memory');
if (config.files.scanner === 'none')
  logger.warn('No malware scanner configured (development only)');
if (!config.jwtPrivateJwk)
  logger.warn('API_JWT_PRIVATE_JWK not set: using an ephemeral signing key');

const store =
  config.files.store === 's3'
    ? createS3ObjectStore({
        bucket: config.files.bucket,
        region: config.files.region,
        ...(config.files.endpoint ? { endpoint: config.files.endpoint } : {}),
      })
    : createMemoryObjectStore();

const bucket = {
  bucket: config.files.bucket,
  region: config.files.region,
  ...(config.files.endpoint ? { endpoint: config.files.endpoint } : {}),
};
const scanner =
  config.files.scanner === 'guardduty'
    ? createGuardDutyScanner(bucket)
    : config.files.scanner === 'clamav'
      ? createClamAvScanner({ ...bucket, ...config.files.clamav })
      : noScanner;

const app = await buildApp({ config, database, redis, logger, store, scanner });

const shutdown = async () => {
  await app.close();
  await database.close();
  redis?.disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: config.host });

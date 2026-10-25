import process from 'node:process';
import { randomBytes } from 'node:crypto';
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('base64url');
process.env.JWT_ACCESS_TTL = '900';
process.env.REFRESH_TOKEN_TTL = '2592000';
process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:63999';
process.env.SLA_QUEUE_PREFIX = 'test-' + randomBytes(12).toString('hex');

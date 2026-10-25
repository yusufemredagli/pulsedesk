import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { validateEnvironment } from '../src/config/environment';
import { PasswordService } from '../src/modules/auth/password.service';

test('auth configuration uses bounded lifetimes and never defaults the secret', () => {
  const JWT_ACCESS_SECRET = randomBytes(48).toString('base64url');
  const config = validateEnvironment({
    REDIS_URL: process.env.REDIS_URL,
    JWT_ACCESS_SECRET,
  });
  assert.equal(config.JWT_ACCESS_TTL, 900);
  assert.equal(config.REFRESH_TOKEN_TTL, 2592000);
  for (const secret of [
    undefined,
    '',
    'short',
    'a'.repeat(64),
    'change-me-in-production-long-placeholder',
  ]) {
    assert.throws(
      () =>
        validateEnvironment({
          REDIS_URL: process.env.REDIS_URL,
          JWT_ACCESS_SECRET: secret,
        }),
      /JWT_ACCESS_SECRET/,
    );
  }
  for (const JWT_ACCESS_TTL of [0, '', 1201, '15m', '2.5']) {
    assert.throws(
      () =>
        validateEnvironment({
          REDIS_URL: process.env.REDIS_URL,
          JWT_ACCESS_SECRET,
          JWT_ACCESS_TTL,
        }),
      /JWT_ACCESS_TTL/,
    );
  }
  for (const REFRESH_TOKEN_TTL of [0, 3599, 7776001, '30d']) {
    assert.throws(
      () =>
        validateEnvironment({
          REDIS_URL: process.env.REDIS_URL,
          JWT_ACCESS_SECRET,
          REFRESH_TOKEN_TTL,
        }),
      /REFRESH_TOKEN_TTL/,
    );
  }
});

test('passwords use salted Argon2id and support generic missing-user verification', async () => {
  const passwords = new PasswordService();
  const password = 'a long plain password without complexity rules';
  const first = await passwords.hash(password);
  const second = await passwords.hash(password);
  assert.match(first, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  assert.notEqual(first, second);
  assert.equal(await passwords.matches(password, first), true);
  assert.equal(await passwords.matches('a different password', first), false);
  assert.equal(await passwords.matches(password), false);
  assert.equal(await passwords.matches(password, 'invalid hash'), false);
});

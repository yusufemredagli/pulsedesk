import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedFrontendOrigins } from '../src/config/realtime';
test('realtime origins are explicit, bounded and require HTTPS in production', () => {
  assert.deepEqual(allowedFrontendOrigins({}), ['http://localhost:3000']);
  assert.deepEqual(
    allowedFrontendOrigins({
      NODE_ENV: 'production',
      FRONTEND_ORIGINS: 'https://desk.example,https://ops.example',
    }),
    ['https://desk.example', 'https://ops.example'],
  );
  for (const FRONTEND_ORIGINS of [
    '',
    '*',
    'https://*.example',
    'https://desk.example/path',
    'null',
    'https://u:p@desk.example',
    'https://desk.example/',
  ])
    assert.throws(() => allowedFrontendOrigins({ FRONTEND_ORIGINS }));
  assert.throws(() => allowedFrontendOrigins({ NODE_ENV: 'production' }));
  assert.throws(() =>
    allowedFrontendOrigins({
      NODE_ENV: 'production',
      FRONTEND_ORIGINS: 'http://desk.example',
    }),
  );
});

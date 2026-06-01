import * as assert from 'node:assert/strict';
import { buildExtensionAuthUrl } from '../../auth/browser-login';

suite('browser auth helpers', () => {
  test('builds ideNew browser auth url', () => {
    const url = buildExtensionAuthUrl({
      baseUrl: 'http://127.0.0.1:3002/',
      tenantHost: 'tenant.localhost',
      callbackUrl: 'http://127.0.0.1:48123/callback',
      state: 'abc123',
    });
    assert.equal(
      url,
      'http://127.0.0.1:3002/extension-auth?callbackUrl=http%3A%2F%2F127.0.0.1%3A48123%2Fcallback&state=abc123&tenantHost=tenant.localhost',
    );
  });
});

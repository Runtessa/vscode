import * as http from 'node:http';
import * as crypto from 'node:crypto';
import * as vscode from 'vscode';

const CALLBACK_HOST = '127.0.0.1';
const CALLBACK_PATH = '/callback';
const TIMEOUT_MS = 3 * 60 * 1000;

type BrowserLoginOptions = {
  baseUrl: string;
  tenantHost: string;
};

type CallbackPayload = {
  sessionToken?: unknown;
  state?: unknown;
};

const normalizeBaseUrl = (value: string) => String(value || '').trim().replace(/\/+$/, '');
const normalizeTenantHost = (value: string) => String(value || '').trim();

const isValidSessionToken = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length >= 24;

const getCorsHeaders = (origin?: string) => ({
  'access-control-allow-origin': origin || '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
  vary: 'origin',
});

const writeJson = (
  res: http.ServerResponse,
  statusCode: number,
  payload: unknown,
  origin?: string,
) => {
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    ...getCorsHeaders(origin),
  });
  res.end(JSON.stringify(payload));
};

const writeHtml = (
  res: http.ServerResponse,
  statusCode: number,
  html: string,
  origin?: string,
) => {
  res.writeHead(statusCode, {
    'content-type': 'text/html; charset=utf-8',
    ...getCorsHeaders(origin),
  });
  res.end(html);
};

const readJsonBody = (req: http.IncomingMessage) =>
  new Promise<CallbackPayload>((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 64_000) {
        reject(new Error('Callback payload too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? (JSON.parse(raw) as CallbackPayload) : {});
      } catch {
        reject(new Error('Invalid callback payload.'));
      }
    });
    req.on('error', reject);
  });

const renderHtml = (title: string, body: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: sans-serif; padding: 32px; background: #16181D; color: #F5F7F8; }
      .card { max-width: 560px; margin: 0 auto; background: #20242C; border: 1px solid #353C47; border-radius: 16px; padding: 24px; }
      h1 { margin-top: 0; font-size: 22px; }
      p { line-height: 1.5; color: #C7CDD4; }
      code { background: #121418; padding: 2px 6px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${title}</h1>
      <p>${body}</p>
    </div>
  </body>
</html>`;

const extractCallbackPayload = async (
  req: http.IncomingMessage,
  requestUrl: URL,
): Promise<CallbackPayload> => {
  if (req.method === 'GET') {
    return {
      sessionToken: requestUrl.searchParams.get('sessionToken') || undefined,
      state: requestUrl.searchParams.get('state') || undefined,
    };
  }
  return readJsonBody(req);
};

export const buildExtensionAuthUrl = ({
  baseUrl,
  tenantHost,
  callbackUrl,
  state,
}: BrowserLoginOptions & { callbackUrl: string; state: string }) => {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}/extension-auth`);
  url.searchParams.set('callbackUrl', callbackUrl);
  url.searchParams.set('state', state);
  const normalizedTenantHost = normalizeTenantHost(tenantHost);
  if (normalizedTenantHost) {
    url.searchParams.set('tenantHost', normalizedTenantHost);
  }
  return url.toString();
};

export const startBrowserLogin = async ({ baseUrl, tenantHost }: BrowserLoginOptions): Promise<string> => {
  const state = crypto.randomBytes(16).toString('hex');

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let timeout: NodeJS.Timeout | null = null;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      server.close(() => fn());
    };

    const server = http.createServer(async (req, res) => {
      const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
      try {
        if (!req.url) {
          writeHtml(res, 400, renderHtml('Invalid request', 'Missing callback URL.'), origin);
          return;
        }

        const requestUrl = new URL(req.url, `http://${CALLBACK_HOST}`);

        if (req.method === 'OPTIONS' && requestUrl.pathname === CALLBACK_PATH) {
          res.writeHead(204, getCorsHeaders(origin));
          res.end();
          return;
        }

        if (req.method === 'GET' && requestUrl.pathname === '/') {
          writeHtml(
            res,
            200,
            renderHtml('Waiting for sign-in', 'Return to the browser sign-in page to complete authentication.'),
            origin,
          );
          return;
        }

        if ((req.method !== 'POST' && req.method !== 'GET') || requestUrl.pathname !== CALLBACK_PATH) {
          writeHtml(
            res,
            404,
            renderHtml('Not found', 'This callback endpoint only accepts sign-in completion requests.'),
            origin,
          );
          return;
        }

        const payload = await extractCallbackPayload(req, requestUrl);
        if (payload.state !== state) {
          writeHtml(res, 400, renderHtml('Sign-in rejected', 'Invalid sign-in state.'), origin);
          return;
        }
        if (!isValidSessionToken(payload.sessionToken)) {
          writeHtml(res, 400, renderHtml('Sign-in rejected', 'Missing session token.'), origin);
          return;
        }

        const sessionToken = payload.sessionToken.trim();
        writeHtml(
          res,
          200,
          renderHtml('Sign-in completed', 'Authentication succeeded. Return to VS Code.'),
          origin,
        );
        finish(() => resolve(sessionToken));
      } catch (error) {
        const message = (error as Error)?.message || 'Sign-in callback failed.';
        writeHtml(res, 500, renderHtml('Sign-in failed', message), origin);
      }
    });

    server.on('error', (error) => finish(() => reject(error)));

    server.listen(0, CALLBACK_HOST, async () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        finish(() => reject(new Error('Failed to create local sign-in callback server.')));
        return;
      }
      timeout = setTimeout(() => {
        finish(() => reject(new Error('Browser sign-in timed out.')));
      }, TIMEOUT_MS);

      const callbackUrl = `http://${CALLBACK_HOST}:${address.port}${CALLBACK_PATH}`;
      const authUrl = buildExtensionAuthUrl({ baseUrl, tenantHost, callbackUrl, state });
      await vscode.env.openExternal(vscode.Uri.parse(authUrl));
    });
  });
};

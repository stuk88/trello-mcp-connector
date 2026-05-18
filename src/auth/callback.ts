import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

export interface CallbackResult {
  oauthToken: string;
  oauthVerifier: string;
}

export interface CallbackHandle {
  url: string;
  port: number;
  /** Resolves when the OAuth provider hits the callback URL. */
  result: Promise<CallbackResult>;
  close: () => Promise<void>;
}

const SUCCESS_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Trello connector — authorized</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:520px;margin:6em auto;color:#222}</style></head>
<body><h1>Authorized</h1><p>You can close this tab and return to your terminal.</p></body></html>`;

const ERROR_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Trello connector — error</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:520px;margin:6em auto;color:#222}</style></head>
<body><h1>Authorization failed</h1><p>Missing oauth_token or oauth_verifier in the callback.</p></body></html>`;

export function startCallbackServer(opts: {
  path?: string;
  host?: string;
  port?: number;
  timeoutMs?: number;
} = {}): Promise<CallbackHandle> {
  const path = opts.path ?? "/oauth/callback";
  const host = opts.host ?? "127.0.0.1";

  return new Promise((resolveStart, rejectStart) => {
    let resolveResult!: (r: CallbackResult) => void;
    let rejectResult!: (e: Error) => void;
    const result = new Promise<CallbackResult>((res, rej) => {
      resolveResult = res;
      rejectResult = rej;
    });

    const server: Server = createServer((req, res) => {
      if (!req.url) {
        res.statusCode = 400;
        res.end();
        return;
      }
      const parsed = new URL(req.url, `http://${host}`);
      if (parsed.pathname !== path) {
        res.statusCode = 404;
        res.end();
        return;
      }
      const oauthToken = parsed.searchParams.get("oauth_token");
      const oauthVerifier = parsed.searchParams.get("oauth_verifier");
      if (!oauthToken || !oauthVerifier) {
        res.statusCode = 400;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(ERROR_HTML);
        rejectResult(new Error("callback missing oauth_token or oauth_verifier"));
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(SUCCESS_HTML);
      resolveResult({ oauthToken, oauthVerifier });
    });

    const timeout = setTimeout(
      () => rejectResult(new Error("OAuth callback timed out")),
      opts.timeoutMs ?? 5 * 60_000,
    );

    server.on("error", rejectStart);
    server.listen(opts.port ?? 0, host, () => {
      const addr = server.address() as AddressInfo;
      const port = addr.port;
      const url = `http://${host}:${port}${path}`;
      const close = async () => {
        clearTimeout(timeout);
        await new Promise<void>((r) => server.close(() => r()));
      };
      resolveStart({
        url,
        port,
        result: result.finally(() => clearTimeout(timeout)),
        close,
      });
    });
  });
}

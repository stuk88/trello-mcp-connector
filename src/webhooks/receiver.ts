#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { tryLoadConfig } from "../config.js";

interface ReceiverOptions {
  port: number;
  callbackUrl: string;
  logPath: string;
  consumerSecret: string | null;
}

/**
 * Verify the `x-trello-webhook` header per Trello docs:
 *   base64(HMAC-SHA1(rawBody + callbackURL, consumerSecret))
 */
export function verifyTrelloSignature(
  consumerSecret: string,
  rawBody: string,
  callbackURL: string,
  headerValue: string,
): boolean {
  const expected = createHmac("sha1", consumerSecret)
    .update(rawBody + callbackURL)
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(headerValue);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ReceiverOptions,
): Promise<void> {
  if (req.method === "HEAD") {
    res.statusCode = 200;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "HEAD, POST");
    res.end();
    return;
  }

  const body = await readBody(req);
  const sigHeader = req.headers["x-trello-webhook"];
  const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;

  // Fail closed when the consumer secret is configured: a missing or invalid
  // signature is treated as a forgery attempt. The only path that logs an
  // event with `verified: null` is when the receiver wasn't given a secret
  // at all (config error path), and even then we keep the body for audit.
  let verified: boolean | null = null;
  if (opts.consumerSecret) {
    if (!signature) {
      res.statusCode = 401;
      res.end("missing x-trello-webhook header");
      return;
    }
    verified = verifyTrelloSignature(
      opts.consumerSecret,
      body,
      opts.callbackUrl,
      signature,
    );
    if (!verified) {
      res.statusCode = 401;
      res.end("invalid signature");
      return;
    }
  }

  let parsed: unknown = null;
  try {
    parsed = body.length > 0 ? JSON.parse(body) : null;
  } catch {
    parsed = body;
  }

  const entry = {
    receivedAt: new Date().toISOString(),
    verified,
    headers: {
      "x-trello-webhook": signature ?? null,
      "content-type": req.headers["content-type"] ?? null,
    },
    body: parsed,
  };

  await mkdir(dirname(opts.logPath), { recursive: true, mode: 0o700 });
  await appendFile(opts.logPath, JSON.stringify(entry) + "\n", { mode: 0o600 });

  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true }));
}

export function startReceiver(opts: ReceiverOptions): Promise<{
  close: () => Promise<void>;
}> {
  const server = createServer((req, res) => {
    handleRequest(req, res, opts).catch((e) => {
      process.stderr.write(`[trello-webhook] error: ${(e as Error).stack ?? e}\n`);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("internal error");
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(opts.port, () => {
      process.stderr.write(
        `[trello-webhook] listening on :${opts.port}, logging to ${opts.logPath}\n` +
          `  callbackURL (must be advertised to Trello): ${opts.callbackUrl}\n`,
      );
      resolve({
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function parseFlags(argv: string[]): { callbackUrl: string | null; port: number | null } {
  let callbackUrl: string | null = null;
  let port: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--callback-url" && i + 1 < argv.length) {
      callbackUrl = argv[++i] ?? null;
    } else if (arg === "--port" && i + 1 < argv.length) {
      const next = argv[++i];
      port = next ? Number(next) : null;
    }
  }
  return { callbackUrl, port };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const { config } = tryLoadConfig();
  const port = flags.port ?? config?.webhookPort ?? 4567;
  const callbackUrl =
    flags.callbackUrl ?? process.env.TRELLO_WEBHOOK_CALLBACK_URL ?? `http://localhost:${port}/`;
  const logPath =
    process.env.TRELLO_WEBHOOK_LOG ??
    join(config?.connectorHome ?? `${process.env.HOME}/.trello-connector`, "webhook-events.log");

  if (!flags.callbackUrl && !process.env.TRELLO_WEBHOOK_CALLBACK_URL) {
    process.stderr.write(
      "[trello-webhook] warning: no --callback-url given. Signature verification needs the exact callbackURL registered with Trello. Pass --callback-url or set TRELLO_WEBHOOK_CALLBACK_URL.\n",
    );
  }

  await startReceiver({
    port,
    callbackUrl,
    logPath,
    consumerSecret: config?.consumerSecret ?? null,
  });
}

// Run when invoked as a script (not when imported for tests).
const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return entry.endsWith("receiver.ts") || entry.endsWith("receiver.js");
})();

if (isMain) {
  main().catch((e) => {
    process.stderr.write(`[trello-webhook] fatal: ${(e as Error).stack ?? e}\n`);
    process.exit(1);
  });
}

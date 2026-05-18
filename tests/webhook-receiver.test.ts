import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startReceiver, verifyTrelloSignature } from "../src/webhooks/receiver.js";

describe("verifyTrelloSignature", () => {
  it("accepts a signature computed as base64(HMAC-SHA1(body + callbackURL, secret))", () => {
    const body = '{"action":{"type":"createCard"}}';
    const callbackURL = "https://my.app/trello";
    const secret = "consumer-secret";
    const sig = createHmac("sha1", secret).update(body + callbackURL).digest("base64");
    expect(verifyTrelloSignature(secret, body, callbackURL, sig)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const body = "x";
    const url = "https://my.app/trello";
    const wrong = createHmac("sha1", "other").update(body + url).digest("base64");
    expect(verifyTrelloSignature("consumer-secret", body, url, wrong)).toBe(false);
  });

  it("rejects mismatched lengths without throwing", () => {
    expect(verifyTrelloSignature("s", "b", "u", "short")).toBe(false);
  });
});

describe("startReceiver (integration)", () => {
  let dir: string;
  let logPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "trello-hook-"));
    logPath = join(dir, "events.log");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("answers HEAD with 200, accepts a properly-signed POST, and appends a log entry", async () => {
    const port = 19_000 + Math.floor(Math.random() * 1000);
    const callbackUrl = `http://127.0.0.1:${port}/`;
    const consumerSecret = "cs";
    const handle = await startReceiver({
      port,
      callbackUrl,
      logPath,
      consumerSecret,
    });
    try {
      const head = await fetch(callbackUrl, { method: "HEAD" });
      expect(head.status).toBe(200);

      const body = JSON.stringify({ action: { type: "createCard", id: "abc" } });
      const sig = createHmac("sha1", consumerSecret).update(body + callbackUrl).digest("base64");

      const post = await fetch(callbackUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "x-trello-webhook": sig },
        body,
      });
      expect(post.status).toBe(200);
      expect(await post.json()).toEqual({ ok: true });

      const raw = await readFile(logPath, "utf8");
      const entries = raw
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { body: unknown; verified: boolean });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.verified).toBe(true);
      expect(entries[0]!.body).toEqual({ action: { type: "createCard", id: "abc" } });
    } finally {
      await handle.close();
    }
  });

  it("rejects a POST with an invalid signature (401) and writes no log", async () => {
    const port = 20_000 + Math.floor(Math.random() * 1000);
    const callbackUrl = `http://127.0.0.1:${port}/`;
    const handle = await startReceiver({
      port,
      callbackUrl,
      logPath,
      consumerSecret: "cs",
    });
    try {
      const post = await fetch(callbackUrl, {
        method: "POST",
        headers: { "x-trello-webhook": "not-a-valid-signature" },
        body: "{}",
      });
      expect(post.status).toBe(401);
      await expect(readFile(logPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await handle.close();
    }
  });

  it("rejects a POST without the x-trello-webhook header when a secret is configured", async () => {
    const port = 22_000 + Math.floor(Math.random() * 1000);
    const callbackUrl = `http://127.0.0.1:${port}/`;
    const handle = await startReceiver({
      port,
      callbackUrl,
      logPath,
      consumerSecret: "cs",
    });
    try {
      const post = await fetch(callbackUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(post.status).toBe(401);
      await expect(readFile(logPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await handle.close();
    }
  });

  it("returns 405 for unsupported methods", async () => {
    const port = 21_000 + Math.floor(Math.random() * 1000);
    const callbackUrl = `http://127.0.0.1:${port}/`;
    const handle = await startReceiver({
      port,
      callbackUrl,
      logPath,
      consumerSecret: null,
    });
    try {
      const res = await fetch(callbackUrl, { method: "GET" });
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("HEAD, POST");
    } finally {
      await handle.close();
    }
  });
});

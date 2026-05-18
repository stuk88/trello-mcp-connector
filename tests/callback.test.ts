import { describe, expect, it } from "vitest";
import { startCallbackServer } from "../src/auth/callback.js";

describe("startCallbackServer", () => {
  it("resolves with oauth_token + oauth_verifier when Trello hits the callback", async () => {
    const cb = await startCallbackServer();
    try {
      const hitUrl = `${cb.url}?oauth_token=REQ-TOKEN&oauth_verifier=verifier-xyz`;
      const [hitResponse, result] = await Promise.all([fetch(hitUrl), cb.result]);
      expect(hitResponse.status).toBe(200);
      const html = await hitResponse.text();
      expect(html).toContain("Authorized");
      expect(result).toEqual({ oauthToken: "REQ-TOKEN", oauthVerifier: "verifier-xyz" });
    } finally {
      await cb.close();
    }
  });

  it("rejects the result and returns 400 when callback is missing params", async () => {
    const cb = await startCallbackServer();
    try {
      const errPromise = cb.result.catch((e: Error) => e);
      const res = await fetch(`${cb.url}?bogus=1`);
      expect(res.status).toBe(400);
      const e = await errPromise;
      expect((e as Error).message).toMatch(/missing/);
    } finally {
      await cb.close();
    }
  });

  it("returns 404 on unrelated paths", async () => {
    const cb = await startCallbackServer();
    try {
      const errPromise = cb.result.catch(() => "ignored");
      const res = await fetch(`http://127.0.0.1:${cb.port}/elsewhere`);
      expect(res.status).toBe(404);
      // Hit the real callback so result resolves and close() doesn't hang
      await fetch(`${cb.url}?oauth_token=t&oauth_verifier=v`);
      await errPromise;
    } finally {
      await cb.close();
    }
  });
});

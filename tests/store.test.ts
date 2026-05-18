import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TokenStore } from "../src/auth/store.js";
import type { PersistedAuth } from "../src/trello/types.js";

describe("TokenStore", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "trello-store-"));
    path = join(dir, "tokens.json");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null when no file exists", async () => {
    const store = new TokenStore(path);
    expect(await store.load()).toBeNull();
  });

  it("round-trips a persisted token and writes mode 0600", async () => {
    const store = new TokenStore(path);
    const auth: PersistedAuth = {
      token: "tk",
      tokenSecret: "ts",
      consumerKey: "ck",
      obtainedAt: "2026-01-01T00:00:00.000Z",
      scope: "read,write",
      expiration: "never",
    };
    await store.save(auth);
    const loaded = await store.load();
    expect(loaded).toEqual(auth);

    const st = await stat(path);
    // mode bits include file-type — mask to permission bits
    expect(st.mode & 0o777).toBe(0o600);

    // file is human-readable JSON
    const raw = await readFile(path, "utf8");
    expect(JSON.parse(raw)).toEqual(auth);
  });

  it("clear() returns true when it removes a file, false when nothing to remove", async () => {
    const store = new TokenStore(path);
    expect(await store.clear()).toBe(false);
    await store.save({
      token: "tk",
      tokenSecret: "ts",
      consumerKey: "ck",
      obtainedAt: "2026-01-01T00:00:00.000Z",
      scope: "read",
      expiration: "never",
    });
    expect(await store.clear()).toBe(true);
    expect(await store.load()).toBeNull();
  });
});

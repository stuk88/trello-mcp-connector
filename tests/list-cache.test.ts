import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LIST_CACHE_FILENAME,
  ListCacheError,
  cachePath,
  readListCache,
  writeListCache,
  type ListCache,
} from "../src/list-cache.js";

describe("list-cache", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "trello-lc-"));
    path = join(dir, LIST_CACHE_FILENAME);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const sample: ListCache = {
    boardId: "B1",
    boardName: "Demo",
    fetchedAt: "2026-05-15T00:00:00.000Z",
    lists: [
      { id: "L1", name: "Backlog", closed: false, pos: 1 },
      { id: "L2", name: "Done", closed: false, pos: 2 },
    ],
    statusMapping: { backlog: "L1", done: "L2" },
  };

  it("cachePath defaults to <cwd>/.trello-list-mapping.json", () => {
    expect(cachePath("/proj")).toBe(`/proj/${LIST_CACHE_FILENAME}`);
  });

  it("cachePath honours absolute env path", () => {
    expect(cachePath("/proj", "/etc/foo.json")).toBe("/etc/foo.json");
  });

  it("cachePath joins a relative env path with cwd", () => {
    expect(cachePath("/proj", "custom/foo.json")).toBe(
      "/proj/custom/foo.json",
    );
  });

  it("returns null when the cache file is absent", () => {
    expect(readListCache(path)).toBeNull();
  });

  it("round-trips a cache", () => {
    writeListCache(path, sample);
    expect(readListCache(path)).toEqual(sample);
  });

  it("writes pretty-printed JSON with a trailing newline", async () => {
    writeListCache(path, sample);
    const raw = await readFile(path, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain('"boardId": "B1"');
    expect(JSON.parse(raw)).toEqual(sample);
  });

  it("creates the parent directory if it doesn't exist", () => {
    const nested = join(dir, "deeply", "nested", LIST_CACHE_FILENAME);
    writeListCache(nested, sample);
    expect(readListCache(nested)).toEqual(sample);
  });

  it("throws ListCacheError on malformed JSON", async () => {
    await writeFile(path, "{ not json");
    expect(() => readListCache(path)).toThrowError(ListCacheError);
  });

  it("throws ListCacheError when required fields are missing", async () => {
    await writeFile(path, JSON.stringify({ boardId: "B1" }));
    expect(() => readListCache(path)).toThrowError(/missing required fields/);
  });

  it("supports injected read for testing without disk I/O", () => {
    const result = readListCache("/virtual/path", () => JSON.stringify(sample));
    expect(result).toEqual(sample);
  });
});

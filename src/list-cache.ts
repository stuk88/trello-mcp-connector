import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { TaskStatus } from "./status-mapping.js";

export const LIST_CACHE_FILENAME = ".trello-list-mapping.json";

export interface CachedList {
  id: string;
  name: string;
  closed: boolean;
  pos: number;
}

export interface ListCache {
  boardId: string;
  boardName: string | null;
  fetchedAt: string;
  lists: CachedList[];
  statusMapping: Partial<Record<TaskStatus, string>>;
}

export class ListCacheError extends Error {}

export function cachePath(cwd: string, envPath?: string): string {
  if (!envPath) return join(cwd, LIST_CACHE_FILENAME);
  return isAbsolute(envPath) ? envPath : join(cwd, envPath);
}

export function readListCache(
  path: string,
  read: (p: string) => string = (p) => readFileSync(p, "utf8"),
): ListCache | null {
  let raw: string;
  try {
    raw = read(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ListCacheError(
      `Could not read list cache at ${path}: ${(e as Error).message}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new ListCacheError(
      `Malformed list cache at ${path}: ${(e as Error).message}`,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new ListCacheError(`List cache at ${path} is not an object`);
  }
  const cache = parsed as ListCache;
  if (
    typeof cache.boardId !== "string" ||
    !Array.isArray(cache.lists) ||
    typeof cache.statusMapping !== "object"
  ) {
    throw new ListCacheError(
      `List cache at ${path} is missing required fields (boardId, lists, statusMapping)`,
    );
  }
  return cache;
}

export function writeListCache(
  path: string,
  cache: ListCache,
  write: (p: string, contents: string) => void = (p, c) => writeFileSync(p, c),
  ensureDir: (d: string) => void = (d) => mkdirSync(d, { recursive: true }),
): void {
  ensureDir(dirname(path));
  write(path, JSON.stringify(cache, null, 2) + "\n");
}

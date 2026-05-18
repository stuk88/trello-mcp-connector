import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PersistedAuth } from "../trello/types.js";

export class TokenStore {
  constructor(private readonly path: string) {}

  async load(): Promise<PersistedAuth | null> {
    try {
      const buf = await readFile(this.path, "utf8");
      return JSON.parse(buf) as PersistedAuth;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async save(auth: PersistedAuth): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await writeFile(this.path, JSON.stringify(auth, null, 2), { mode: 0o600 });
    await chmod(this.path, 0o600);
  }

  async clear(): Promise<boolean> {
    try {
      await unlink(this.path);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw e;
    }
  }
}

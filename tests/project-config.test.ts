import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PROJECT_CONFIG_FILENAME,
  loadProjectConfig,
} from "../src/project-config.js";

describe("loadProjectConfig", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "trello-pc-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null config + null sourcePath when no file exists", () => {
    const result = loadProjectConfig({ cwd: dir });
    expect(result).toEqual({ config: null, sourcePath: null, error: null });
  });

  it("loads a valid config from <cwd>/trello.config.json", async () => {
    await writeFile(
      join(dir, PROJECT_CONFIG_FILENAME),
      JSON.stringify({ orgId: "o1", boardId: "b1", listId: "l1" }),
    );
    const result = loadProjectConfig({ cwd: dir });
    expect(result.config).toEqual({ orgId: "o1", boardId: "b1", listId: "l1" });
    expect(result.sourcePath).toBe(join(dir, PROJECT_CONFIG_FILENAME));
    expect(result.error).toBeNull();
  });

  it("accepts a partial config (all fields optional)", async () => {
    await writeFile(
      join(dir, PROJECT_CONFIG_FILENAME),
      JSON.stringify({ boardId: "b1" }),
    );
    const result = loadProjectConfig({ cwd: dir });
    expect(result.config).toEqual({ boardId: "b1" });
    expect(result.error).toBeNull();
  });

  it("reports a parse error for malformed JSON without crashing", async () => {
    await writeFile(join(dir, PROJECT_CONFIG_FILENAME), "{ this is not json");
    const result = loadProjectConfig({ cwd: dir });
    expect(result.config).toBeNull();
    expect(result.sourcePath).toBe(join(dir, PROJECT_CONFIG_FILENAME));
    expect(result.error).toMatch(/Malformed JSON/);
  });

  it("reports a schema error for unknown fields (strict)", async () => {
    await writeFile(
      join(dir, PROJECT_CONFIG_FILENAME),
      JSON.stringify({ boardId: "b1", randomField: "x" }),
    );
    const result = loadProjectConfig({ cwd: dir });
    expect(result.config).toBeNull();
    expect(result.error).toMatch(/Invalid trello.config.json/);
    expect(result.error).toMatch(/randomField/);
  });

  it("rejects empty-string ids (z.string().min(1))", async () => {
    await writeFile(
      join(dir, PROJECT_CONFIG_FILENAME),
      JSON.stringify({ boardId: "" }),
    );
    const result = loadProjectConfig({ cwd: dir });
    expect(result.config).toBeNull();
    expect(result.error).toMatch(/boardId/);
  });

  it("honors TRELLO_PROJECT_CONFIG envPath (absolute)", async () => {
    const customPath = join(dir, "custom.json");
    await writeFile(customPath, JSON.stringify({ boardId: "from-custom" }));
    const result = loadProjectConfig({ cwd: dir, envPath: customPath });
    expect(result.config).toEqual({ boardId: "from-custom" });
    expect(result.sourcePath).toBe(customPath);
  });

  it("honors TRELLO_PROJECT_CONFIG envPath (relative — joined with cwd)", async () => {
    await writeFile(
      join(dir, "nested.json"),
      JSON.stringify({ orgId: "from-relative" }),
    );
    const result = loadProjectConfig({ cwd: dir, envPath: "nested.json" });
    expect(result.config).toEqual({ orgId: "from-relative" });
    expect(result.sourcePath).toBe(join(dir, "nested.json"));
  });
});

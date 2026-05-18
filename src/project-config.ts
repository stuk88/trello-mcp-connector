import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { z } from "zod";

export const PROJECT_CONFIG_FILENAME = "trello.config.json";

const ProjectConfigSchema = z
  .object({
    orgId: z.string().min(1).optional(),
    boardId: z.string().min(1).optional(),
    listId: z.string().min(1).optional(),
  })
  .strict();

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export interface LoadedProjectConfig {
  config: ProjectConfig | null;
  sourcePath: string | null;
  error: string | null;
}

export interface LoadOptions {
  cwd: string;
  /** Overrides the default `<cwd>/trello.config.json` path. */
  envPath?: string | undefined;
  /** Injectable file reader for tests. */
  readFile?: (path: string) => string;
}

function defaultRead(path: string): string {
  return readFileSync(path, "utf8");
}

function resolvePath(cwd: string, envPath: string | undefined): string {
  if (!envPath) return join(cwd, PROJECT_CONFIG_FILENAME);
  return isAbsolute(envPath) ? envPath : join(cwd, envPath);
}

export function loadProjectConfig(opts: LoadOptions): LoadedProjectConfig {
  const sourcePath = resolvePath(opts.cwd, opts.envPath);
  const read = opts.readFile ?? defaultRead;

  let raw: string;
  try {
    raw = read(sourcePath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { config: null, sourcePath: null, error: null };
    }
    return {
      config: null,
      sourcePath,
      error: `Could not read ${sourcePath}: ${(e as Error).message}`,
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (e) {
    return {
      config: null,
      sourcePath,
      error: `Malformed JSON in ${sourcePath}: ${(e as Error).message}`,
    };
  }

  const parsed = ProjectConfigSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    return {
      config: null,
      sourcePath,
      error: `Invalid ${PROJECT_CONFIG_FILENAME}: ${issues}`,
    };
  }

  return { config: parsed.data, sourcePath, error: null };
}

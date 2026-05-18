import type { Config } from "../config.js";
import { TokenStore } from "../auth/store.js";
import { TrelloClient } from "../trello/client.js";
import { cachePath } from "../list-cache.js";
import { loadProjectConfig, type LoadedProjectConfig } from "../project-config.js";
import type { PersistedAuth } from "../trello/types.js";

export interface ToolContext {
  config: Config | null;
  configError: string | null;
  tokenStorePath: string;
  projectConfig: LoadedProjectConfig;
  /** Resolved absolute path for the per-board list cache (<cwd>/.trello-list-mapping.json). */
  listCachePath: string;
  loadAuth: () => Promise<PersistedAuth | null>;
  saveAuth: (auth: PersistedAuth) => Promise<void>;
  clearAuth: () => Promise<boolean>;
  /** Build a TrelloClient using the persisted token. Throws if not configured/authed. */
  client: () => Promise<TrelloClient>;
}

export interface MakeContextOptions {
  fetchImpl?: typeof fetch;
  projectConfig?: LoadedProjectConfig;
  /** Override the cache file path (defaults to <cwd>/.trello-list-mapping.json). */
  listCachePath?: string;
}

export function makeToolContext(
  config: Config | null,
  configError: string | null,
  options: MakeContextOptions = {},
): ToolContext {
  const tokenStorePath =
    config?.tokenStorePath ?? `${process.env.HOME ?? ""}/.trello-connector/tokens.json`;
  const store = new TokenStore(tokenStorePath);
  const fetchImpl = options.fetchImpl ?? fetch;

  const projectConfig =
    options.projectConfig ??
    loadProjectConfig({
      cwd: process.cwd(),
      envPath: process.env.TRELLO_PROJECT_CONFIG,
    });

  const listCachePath =
    options.listCachePath ??
    cachePath(process.cwd(), process.env.TRELLO_LIST_CACHE);

  if (projectConfig.error) {
    process.stderr.write(`[trello-mcp] project config warning: ${projectConfig.error}\n`);
  }

  return {
    config,
    configError,
    tokenStorePath,
    projectConfig,
    listCachePath,
    loadAuth: () => store.load(),
    saveAuth: (a) => store.save(a),
    clearAuth: () => store.clear(),
    client: async () => {
      if (!config) {
        throw new Error(
          `Trello connector not configured: ${configError ?? "missing env vars"}`,
        );
      }
      const auth = await store.load();
      if (!auth) {
        throw new Error(
          "Not authenticated. Call the `auth_login` tool to complete the OAuth flow.",
        );
      }
      return new TrelloClient({
        creds: {
          consumerKey: config.consumerKey,
          consumerSecret: config.consumerSecret,
          token: auth.token,
          tokenSecret: auth.tokenSecret,
        },
        fetchImpl,
      });
    },
  };
}

/**
 * Resolve a required identifier from either an explicit input or the project
 * config default. Returns the id on success, or a structured error message
 * naming both the input field and the config key the user could set.
 */
export function resolveProjectId(
  explicit: string | undefined,
  configKey: "orgId" | "boardId" | "listId",
  inputName: string,
  ctx: ToolContext,
): { id: string } | { error: string } {
  if (explicit && explicit.length > 0) return { id: explicit };
  const fromConfig = ctx.projectConfig.config?.[configKey];
  if (fromConfig && fromConfig.length > 0) return { id: fromConfig };
  return {
    error:
      `Missing ${inputName}. Either pass it explicitly, or set "${configKey}" in trello.config.json` +
      (ctx.projectConfig.sourcePath ? ` (loaded from ${ctx.projectConfig.sourcePath})` : ""),
  };
}

export function ok(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function err(
  message: string,
): { content: Array<{ type: "text"; text: string }>; isError: true } {
  return { content: [{ type: "text", text: message }], isError: true };
}

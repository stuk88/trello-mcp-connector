import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { tryLoadConfig, type Config } from "./config.js";
import type { LoadedProjectConfig } from "./project-config.js";
import { makeToolContext, type ToolContext } from "./tools/context.js";
import { registerAllTools } from "./tools/register.js";

export interface BuildServerOptions {
  config?: Config | null;
  configError?: string | null;
  fetchImpl?: typeof fetch;
  /** Override the auto-loaded project config (e.g. for tests). */
  projectConfig?: LoadedProjectConfig;
  /** Override the list-cache file path (defaults to <cwd>/.trello-list-mapping.json). */
  listCachePath?: string;
}

export function buildServer(opts: BuildServerOptions = {}): {
  server: McpServer;
  context: ToolContext;
} {
  let config: Config | null;
  let configError: string | null;

  if (opts.config !== undefined) {
    config = opts.config;
    configError = opts.configError ?? null;
  } else {
    const loaded = tryLoadConfig();
    config = loaded.config;
    configError = loaded.error;
  }

  const context = makeToolContext(config, configError, {
    fetchImpl: opts.fetchImpl,
    projectConfig: opts.projectConfig,
    listCachePath: opts.listCachePath,
  });
  const server = new McpServer({
    name: "trello-mcp-connector",
    version: "0.1.0",
  });
  registerAllTools(server, context);
  return { server, context };
}

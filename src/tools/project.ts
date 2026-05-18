import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ok, type ToolContext } from "./context.js";

export function registerProjectTools(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "project_config",
    "Report the loaded project-level Trello config (orgId/boardId/listId defaults), the file it came from, and any parse errors.",
    {},
    async () => {
      return ok({
        sourcePath: ctx.projectConfig.sourcePath,
        config: ctx.projectConfig.config,
        error: ctx.projectConfig.error,
        cwd: process.cwd(),
        envOverride: process.env.TRELLO_PROJECT_CONFIG ?? null,
      });
    },
  );
}

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { err, ok, resolveProjectId, type ToolContext } from "./context.js";

export function registerBoardTools(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "list_boards",
    "List Trello boards. With no `orgId`, returns all boards visible to the authenticated user. With `orgId` (or the project config default), scopes to that organization.",
    {
      filter: z
        .enum(["all", "open", "closed", "members", "organization", "public", "starred"])
        .default("open"),
      orgId: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Trello organization (workspace) id. Falls back to `orgId` in trello.config.json. When neither is set, lists boards across all orgs.",
        ),
    },
    async (input) => {
      const client = await ctx.client();
      const orgId = input.orgId ?? ctx.projectConfig.config?.orgId;
      const boards = orgId
        ? await client.listOrgBoards(orgId, { filter: input.filter })
        : await client.listBoards({ filter: input.filter });
      return ok(boards);
    },
  );

  server.tool(
    "get_board",
    "Fetch one Trello board, optionally including its lists and cards. `boardId` falls back to the project config default.",
    {
      boardId: z
        .string()
        .min(1)
        .optional()
        .describe("Trello board id (or shortLink). Falls back to `boardId` in trello.config.json."),
      lists: z.enum(["all", "open", "closed", "none"]).default("open"),
      cards: z.enum(["all", "open", "closed", "none"]).default("none"),
    },
    async (input) => {
      const resolved = resolveProjectId(input.boardId, "boardId", "boardId", ctx);
      if ("error" in resolved) return err(resolved.error);
      const client = await ctx.client();
      const board = await client.getBoard(resolved.id, {
        lists: input.lists,
        cards: input.cards,
      });
      return ok(board);
    },
  );
}

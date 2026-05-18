import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { writeListCache, type CachedList, type ListCache } from "../list-cache.js";
import { mapListsToStatuses } from "../status-mapping.js";
import { err, ok, resolveProjectId, type ToolContext } from "./context.js";

export function registerListTools(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "list_lists",
    "List the columns/lists on a Trello board. `boardId` falls back to the project config default. By default, also persists a status→list mapping cache (.trello-list-mapping.json) used by `move_card_by_status` — set `cache: false` to skip the side effect.",
    {
      boardId: z
        .string()
        .min(1)
        .optional()
        .describe("Falls back to `boardId` in trello.config.json."),
      filter: z.enum(["all", "open", "closed"]).default("open"),
      cache: z
        .boolean()
        .default(true)
        .describe("When true, also writes the status→list mapping cache to disk."),
    },
    async (input) => {
      const resolved = resolveProjectId(input.boardId, "boardId", "boardId", ctx);
      if ("error" in resolved) return err(resolved.error);
      const client = await ctx.client();
      const lists = await client.listLists(resolved.id, input.filter);

      if (input.cache && input.filter !== "closed") {
        // Only the open lists participate in the status mapping — closed lists
        // are archived. When the caller asked for "all", we still only use
        // open ones for the cache so the mapping reflects current board state.
        const cachedLists: CachedList[] = lists.map((l) => ({
          id: l.id,
          name: l.name,
          closed: l.closed,
          pos: l.pos,
        }));
        const { mapping } = mapListsToStatuses(cachedLists);
        const cache: ListCache = {
          boardId: resolved.id,
          boardName: null,
          fetchedAt: new Date().toISOString(),
          lists: cachedLists,
          statusMapping: mapping,
        };
        try {
          writeListCache(ctx.listCachePath, cache);
        } catch (e) {
          // Surface a warning but do NOT fail the tool — the list data is
          // still useful even if the cache write failed (e.g. read-only fs).
          process.stderr.write(
            `[trello-mcp] list cache write failed: ${(e as Error).message}\n`,
          );
        }
      }

      return ok(lists);
    },
  );

  server.tool(
    "create_list",
    "Create a new list on a board. `boardId` falls back to the project config default.",
    {
      boardId: z
        .string()
        .min(1)
        .optional()
        .describe("Falls back to `boardId` in trello.config.json."),
      name: z.string().min(1),
      pos: z
        .union([z.enum(["top", "bottom"]), z.number()])
        .optional()
        .describe("Position: 'top', 'bottom', or a numeric position."),
    },
    async (input) => {
      const resolved = resolveProjectId(input.boardId, "boardId", "boardId", ctx);
      if ("error" in resolved) return err(resolved.error);
      const client = await ctx.client();
      const list = await client.createList(resolved.id, input.name, input.pos);
      return ok(list);
    },
  );

  server.tool(
    "update_list",
    "Update a list: rename, archive/unarchive, reposition, or move to another board.",
    {
      listId: z.string().min(1),
      name: z.string().min(1).optional(),
      closed: z.boolean().optional().describe("true archives the list, false unarchives."),
      pos: z.union([z.enum(["top", "bottom"]), z.number()]).optional(),
      idBoard: z.string().min(1).optional().describe("Move the list to a different board."),
    },
    async (input) => {
      const client = await ctx.client();
      const { listId, ...patch } = input;
      const list = await client.updateList(listId, patch);
      return ok(list);
    },
  );
}

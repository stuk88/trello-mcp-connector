import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  readListCache,
  writeListCache,
  type CachedList,
  type ListCache,
} from "../list-cache.js";
import {
  TASK_STATUSES,
  mapListsToStatuses,
  statusListSuggestions,
  type MappingResult,
} from "../status-mapping.js";
import type { TrelloClient } from "../trello/client.js";
import type { List } from "../trello/types.js";
import { err, ok, resolveProjectId, type ToolContext } from "./context.js";

const StatusEnum = z.enum(TASK_STATUSES);

/**
 * Fetch lists for the resolved board, compute the status mapping, persist the
 * cache file, and return the full cache + diagnostics.
 */
async function refreshCache(
  client: TrelloClient,
  boardId: string,
  cachePath: string,
): Promise<{ cache: ListCache; mappingResult: MappingResult }> {
  const lists = await client.listLists(boardId, "open");
  const cachedLists: CachedList[] = lists.map((l: List) => ({
    id: l.id,
    name: l.name,
    closed: l.closed,
    pos: l.pos,
  }));
  const mappingResult = mapListsToStatuses(cachedLists);
  const cache: ListCache = {
    boardId,
    boardName: null, // populated lazily when get_board is called; keep cache cheap
    fetchedAt: new Date().toISOString(),
    lists: cachedLists,
    statusMapping: mappingResult.mapping,
  };
  writeListCache(cachePath, cache);
  return { cache, mappingResult };
}

export function registerStatusTools(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "cache_board_lists",
    "Fetch the open lists for a board, map them to task statuses (backlog, todo, in_progress, blocked, review, qa, done, production_critical), and persist the result to `.trello-list-mapping.json` next to the project. Reports which statuses have no matching list and which lists were ambiguous.",
    {
      boardId: z
        .string()
        .min(1)
        .optional()
        .describe("Falls back to `boardId` in trello.config.json."),
    },
    async (input) => {
      const resolved = resolveProjectId(input.boardId, "boardId", "boardId", ctx);
      if ("error" in resolved) return err(resolved.error);
      const client = await ctx.client();
      const { cache, mappingResult } = await refreshCache(
        client,
        resolved.id,
        ctx.listCachePath,
      );
      return ok({
        cachePath: ctx.listCachePath,
        boardId: cache.boardId,
        fetchedAt: cache.fetchedAt,
        listCount: cache.lists.length,
        statusMapping: cache.statusMapping,
        unmapped: mappingResult.unmapped,
        ambiguous: mappingResult.ambiguous,
      });
    },
  );

  server.tool(
    "move_card_by_status",
    "Move a Trello card to the list that matches a task status. Statuses: backlog, todo, in_progress, blocked, review, qa, done, production_critical. Uses the cached status→list mapping for the project's board (refreshes the cache automatically if missing). Pass `refresh: true` to force a re-fetch.",
    {
      cardId: z.string().min(1),
      status: StatusEnum,
      refresh: z.boolean().default(false).describe("Force a fresh cache fetch before resolving."),
    },
    async (input) => {
      const client = await ctx.client();

      const boardResolved = resolveProjectId(
        undefined,
        "boardId",
        "boardId",
        ctx,
      );

      let cache: ListCache | null = null;
      if (!input.refresh) {
        try {
          cache = readListCache(ctx.listCachePath);
        } catch (e) {
          // Malformed cache — fall through to re-warm.
          process.stderr.write(`[trello-mcp] discarding cache: ${(e as Error).message}\n`);
          cache = null;
        }
      }

      const needsRefresh =
        input.refresh ||
        cache === null ||
        ("id" in boardResolved && cache.boardId !== boardResolved.id);

      if (needsRefresh) {
        if ("error" in boardResolved) return err(boardResolved.error);
        const refreshed = await refreshCache(client, boardResolved.id, ctx.listCachePath);
        cache = refreshed.cache;
      }

      const idList = cache!.statusMapping[input.status];
      if (!idList) {
        const unmapped = TASK_STATUSES.filter((s) => !cache!.statusMapping[s]);
        const suggestions = statusListSuggestions(input.status);
        return err(
          `Status "${input.status}" has no matching list on board ${cache!.boardId}. ` +
            `Unmapped statuses: ${unmapped.join(", ")}. ` +
            `Edit your board's list names to match one of: ${suggestions.join(", ")}, ` +
            `or call \`cache_board_lists\` after renaming.`,
        );
      }

      const card = await client.updateCard(input.cardId, { idList });
      const destinationList = cache!.lists.find((l) => l.id === idList);

      // Cache verification: true when project config has a boardId that
      // matches the cache; false when they don't match (we already auto-
      // refreshed in that case so this shouldn't hit); null when we have
      // no project-config boardId to compare against (consumer of the cache
      // is trusting whatever board was last cached — flag it to the user).
      const cacheVerified =
        "id" in boardResolved ? boardResolved.id === cache!.boardId : null;

      return ok({
        card,
        movedTo: {
          status: input.status,
          listId: idList,
          listName: destinationList?.name ?? null,
        },
        cachePath: ctx.listCachePath,
        cacheFetchedAt: cache!.fetchedAt,
        cacheBoardId: cache!.boardId,
        cacheVerified,
        ...(cacheVerified === null && {
          warning:
            `Used cache for board ${cache!.boardId} without verifying against project config. ` +
            `Set \`boardId\` in trello.config.json to confirm the right board, or pass \`refresh: true\` to re-fetch.`,
        }),
      });
    },
  );
}

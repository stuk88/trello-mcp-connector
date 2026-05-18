import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { err, ok, resolveProjectId, type ToolContext } from "./context.js";

export function registerCardTools(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "list_cards",
    "List the cards in a Trello list. `listId` falls back to the project config default.",
    {
      listId: z
        .string()
        .min(1)
        .optional()
        .describe("Falls back to `listId` in trello.config.json."),
    },
    async (input) => {
      const resolved = resolveProjectId(input.listId, "listId", "listId", ctx);
      if ("error" in resolved) return err(resolved.error);
      const client = await ctx.client();
      return ok(await client.listCards(resolved.id));
    },
  );

  server.tool(
    "get_card",
    "Fetch one card with all fields, members, labels, and checklists.",
    {
      cardId: z.string().min(1),
    },
    async (input) => {
      const client = await ctx.client();
      return ok(await client.getCard(input.cardId));
    },
  );

  server.tool(
    "create_card",
    "Create a card on a list. `listId` falls back to the project config default.",
    {
      listId: z
        .string()
        .min(1)
        .optional()
        .describe("Falls back to `listId` in trello.config.json."),
      name: z.string().min(1),
      desc: z.string().optional(),
      due: z.string().optional().describe("ISO 8601 date string for the due date."),
      idMembers: z.array(z.string()).optional(),
      idLabels: z.array(z.string()).optional(),
      pos: z.union([z.enum(["top", "bottom"]), z.number()]).optional(),
    },
    async (input) => {
      const resolved = resolveProjectId(input.listId, "listId", "listId", ctx);
      if ("error" in resolved) return err(resolved.error);
      const client = await ctx.client();
      const card = await client.createCard({
        idList: resolved.id,
        name: input.name,
        desc: input.desc,
        due: input.due,
        idMembers: input.idMembers,
        idLabels: input.idLabels,
        pos: input.pos,
      });
      return ok(card);
    },
  );

  server.tool(
    "update_card",
    "Update fields on a card. Omitted fields are left unchanged.",
    {
      cardId: z.string().min(1),
      name: z.string().optional(),
      desc: z.string().optional(),
      closed: z.boolean().optional(),
      idList: z.string().optional().describe("Move the card to a different list."),
      due: z.string().nullable().optional().describe("ISO 8601 date, or null to clear."),
      dueComplete: z.boolean().optional(),
      idMembers: z.array(z.string()).optional(),
      idLabels: z.array(z.string()).optional(),
      pos: z.union([z.enum(["top", "bottom"]), z.number()]).optional(),
    },
    async (input) => {
      const client = await ctx.client();
      const { cardId, ...patch } = input;
      return ok(await client.updateCard(cardId, patch));
    },
  );

  server.tool(
    "delete_card",
    "Delete a card permanently.",
    {
      cardId: z.string().min(1),
    },
    async (input) => {
      const client = await ctx.client();
      await client.deleteCard(input.cardId);
      return ok({ deleted: true, cardId: input.cardId });
    },
  );
}

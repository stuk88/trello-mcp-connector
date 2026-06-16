import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ok, type ToolContext } from "./context.js";

const pos = z.union([z.enum(["top", "bottom"]), z.number()]).optional();

export function registerChecklistTools(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "list_checklists",
    "List the checklists on a card, each with its check items.",
    {
      cardId: z.string().min(1),
    },
    async (input) => {
      const client = await ctx.client();
      return ok(await client.listChecklists(input.cardId));
    },
  );

  server.tool(
    "create_checklist",
    "Create a checklist on a card.",
    {
      cardId: z.string().min(1),
      name: z.string().min(1),
      pos,
    },
    async (input) => {
      const client = await ctx.client();
      return ok(
        await client.createChecklist(input.cardId, { name: input.name, pos: input.pos }),
      );
    },
  );

  server.tool(
    "delete_checklist",
    "Delete a checklist (and its items) from a card.",
    {
      checklistId: z.string().min(1),
    },
    async (input) => {
      const client = await ctx.client();
      await client.deleteChecklist(input.checklistId);
      return ok({ deleted: true, checklistId: input.checklistId });
    },
  );

  server.tool(
    "add_checkitem",
    "Add an item to a checklist.",
    {
      checklistId: z.string().min(1),
      name: z.string().min(1),
      checked: z
        .boolean()
        .optional()
        .describe("Start the item checked. Defaults to false."),
      pos,
    },
    async (input) => {
      const client = await ctx.client();
      return ok(
        await client.addCheckItem(input.checklistId, {
          name: input.name,
          checked: input.checked,
          pos: input.pos,
        }),
      );
    },
  );

  server.tool(
    "update_checkitem",
    "Update a check item on a card: rename, (un)check via `checked`, or reposition.",
    {
      cardId: z.string().min(1),
      checkItemId: z.string().min(1),
      name: z.string().optional(),
      checked: z.boolean().optional().describe("true → complete, false → incomplete."),
      pos,
    },
    async (input) => {
      const client = await ctx.client();
      const state =
        input.checked === undefined
          ? undefined
          : input.checked
            ? "complete"
            : "incomplete";
      return ok(
        await client.updateCheckItem(input.cardId, input.checkItemId, {
          name: input.name,
          state,
          pos: input.pos,
        }),
      );
    },
  );

  server.tool(
    "delete_checkitem",
    "Delete an item from a checklist.",
    {
      checklistId: z.string().min(1),
      checkItemId: z.string().min(1),
    },
    async (input) => {
      const client = await ctx.client();
      await client.deleteCheckItem(input.checklistId, input.checkItemId);
      return ok({ deleted: true, checkItemId: input.checkItemId });
    },
  );
}

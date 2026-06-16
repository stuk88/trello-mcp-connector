import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ok, type ToolContext } from "./context.js";

export function registerCommentTools(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "list_comments",
    "List the comments on a card (most recent first).",
    {
      cardId: z.string().min(1),
    },
    async (input) => {
      const client = await ctx.client();
      return ok(await client.listComments(input.cardId));
    },
  );

  server.tool(
    "add_comment",
    "Add a comment to a card.",
    {
      cardId: z.string().min(1),
      text: z.string().min(1),
    },
    async (input) => {
      const client = await ctx.client();
      return ok(await client.addComment(input.cardId, input.text));
    },
  );

  server.tool(
    "update_comment",
    "Edit the text of an existing comment.",
    {
      cardId: z.string().min(1),
      commentId: z.string().min(1).describe("The comment action id."),
      text: z.string().min(1),
    },
    async (input) => {
      const client = await ctx.client();
      return ok(await client.updateComment(input.cardId, input.commentId, input.text));
    },
  );

  server.tool(
    "delete_comment",
    "Delete a comment from a card.",
    {
      cardId: z.string().min(1),
      commentId: z.string().min(1).describe("The comment action id."),
    },
    async (input) => {
      const client = await ctx.client();
      await client.deleteComment(input.cardId, input.commentId);
      return ok({ deleted: true, commentId: input.commentId });
    },
  );
}

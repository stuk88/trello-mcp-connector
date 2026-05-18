import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ok, type ToolContext } from "./context.js";

export function registerWebhookTools(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "list_webhooks",
    "List the webhooks owned by the current Trello user token.",
    {},
    async () => {
      const auth = await ctx.loadAuth();
      if (!auth) throw new Error("Not authenticated.");
      const client = await ctx.client();
      return ok(await client.listWebhooks(auth.token));
    },
  );

  server.tool(
    "create_webhook",
    "Register a Trello webhook on a model (board, list, card, member, organization) so Trello POSTs events to the given callbackURL. The URL must be publicly reachable over HTTPS — use a tunnel like ngrok in local development. See `trello-webhook-server` for a local receiver.",
    {
      idModel: z.string().min(1).describe("Trello id of the model to watch."),
      callbackURL: z.string().url().describe("Public HTTPS URL Trello should POST events to."),
      description: z.string().optional(),
      active: z.boolean().default(true),
    },
    async (input) => {
      const client = await ctx.client();
      const webhook = await client.createWebhook({
        idModel: input.idModel,
        callbackURL: input.callbackURL,
        description: input.description,
        active: input.active,
      });
      return ok(webhook);
    },
  );

  server.tool(
    "delete_webhook",
    "Unregister a Trello webhook by id.",
    {
      webhookId: z.string().min(1),
    },
    async (input) => {
      const client = await ctx.client();
      await client.deleteWebhook(input.webhookId);
      return ok({ deleted: true, webhookId: input.webhookId });
    },
  );
}

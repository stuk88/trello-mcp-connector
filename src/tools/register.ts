import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAuthTools } from "./auth.js";
import { registerBoardTools } from "./boards.js";
import { registerCardTools } from "./cards.js";
import { registerAttachmentTools } from "./attachments.js";
import { registerChecklistTools } from "./checklists.js";
import { registerCommentTools } from "./comments.js";
import { registerListTools } from "./lists.js";
import { registerProjectTools } from "./project.js";
import { registerStatusTools } from "./status.js";
import { registerWebhookTools } from "./webhooks.js";
import type { ToolContext } from "./context.js";

export function registerAllTools(server: McpServer, ctx: ToolContext): void {
  registerAuthTools(server, ctx);
  registerProjectTools(server, ctx);
  registerBoardTools(server, ctx);
  registerListTools(server, ctx);
  registerCardTools(server, ctx);
  registerAttachmentTools(server, ctx);
  registerChecklistTools(server, ctx);
  registerCommentTools(server, ctx);
  registerStatusTools(server, ctx);
  registerWebhookTools(server, ctx);
}

import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { err, ok, type ToolContext } from "./context.js";

export function registerAttachmentTools(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "list_attachments",
    "List the attachments on a card.",
    {
      cardId: z.string().min(1),
    },
    async (input) => {
      const client = await ctx.client();
      return ok(await client.listAttachments(input.cardId));
    },
  );

  server.tool(
    "attach_url",
    "Attach a URL (link) to a card. Trello fetches and previews it server-side.",
    {
      cardId: z.string().min(1),
      url: z.string().url(),
      name: z.string().optional().describe("Display name; defaults to the URL."),
      setCover: z.boolean().optional(),
    },
    async (input) => {
      const client = await ctx.client();
      return ok(
        await client.attachUrl(input.cardId, {
          url: input.url,
          name: input.name,
          setCover: input.setCover,
        }),
      );
    },
  );

  server.tool(
    "attach_file",
    "Upload a file attachment to a card. Provide exactly one of `filePath` (read from " +
      "local disk) or `base64` (raw bytes — `name` is then required).",
    {
      cardId: z.string().min(1),
      filePath: z
        .string()
        .min(1)
        .optional()
        .describe("Local path, absolute or relative to the working directory."),
      base64: z.string().min(1).optional().describe("Base64-encoded file contents."),
      name: z
        .string()
        .optional()
        .describe("Attachment name / filename. Required when using `base64`."),
      mimeType: z.string().optional(),
      setCover: z.boolean().optional(),
    },
    async (input) => {
      if ((input.filePath ? 1 : 0) + (input.base64 ? 1 : 0) !== 1) {
        return err("Provide exactly one of `filePath` or `base64`.");
      }

      let data: Buffer;
      let filename: string;
      if (input.filePath) {
        const abs = resolve(process.cwd(), input.filePath);
        try {
          data = await readFile(abs);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ENOENT") {
            return err(`File not found: ${abs}`);
          }
          return err(`Could not read file ${abs}: ${(e as Error).message}`);
        }
        filename = input.name ?? basename(abs);
      } else {
        if (!input.name) {
          return err("`name` is required when using `base64`.");
        }
        data = Buffer.from(input.base64 as string, "base64");
        filename = input.name;
      }

      const client = await ctx.client();
      return ok(
        await client.attachFile(
          input.cardId,
          { data, filename, mimeType: input.mimeType },
          { name: input.name, setCover: input.setCover },
        ),
      );
    },
  );

  server.tool(
    "delete_attachment",
    "Delete an attachment from a card.",
    {
      cardId: z.string().min(1),
      attachmentId: z.string().min(1),
    },
    async (input) => {
      const client = await ctx.client();
      await client.deleteAttachment(input.cardId, input.attachmentId);
      return ok({ deleted: true, attachmentId: input.attachmentId });
    },
  );
}

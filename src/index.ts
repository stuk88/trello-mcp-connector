#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const { server, context } = buildServer();

  // stdout is reserved for the JSON-RPC stream — log to stderr only.
  if (context.configError) {
    process.stderr.write(
      `[trello-mcp] WARN: ${context.configError}. The auth_status tool will report this; auth_login will fail until env vars are set.\n`,
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  process.stderr.write(`[trello-mcp] fatal: ${(e as Error).stack ?? e}\n`);
  process.exit(1);
});

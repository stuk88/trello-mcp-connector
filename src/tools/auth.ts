import { spawn } from "node:child_process";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { startCallbackServer } from "../auth/callback.js";
import { exchangeAccessToken, fetchRequestToken } from "../trello/oauth.js";
import type { PersistedAuth } from "../trello/types.js";
import { err, ok, type ToolContext } from "./context.js";

/**
 * Pure helper: choose the platform-appropriate command + argv to open a URL
 * in the user's default browser. Each form passes the URL as a single argv
 * element so no shell parser can mis-interpret `&`, `^`, quotes, etc.
 *
 *   darwin: open <url>
 *   linux:  xdg-open <url>
 *   win32:  rundll32 url.dll,FileProtocolHandler <url>
 *           (chosen over `cmd /c start` because `start` goes through cmd's
 *           parser, which treats `&` as a command separator inside URLs.)
 */
export function buildOpenCommand(
  platform: NodeJS.Platform,
  url: string,
): { cmd: string; args: string[] } {
  if (platform === "darwin") return { cmd: "open", args: [url] };
  if (platform === "win32") {
    return { cmd: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  }
  return { cmd: "xdg-open", args: [url] };
}

export function openInBrowser(url: string): void {
  const { cmd, args } = buildOpenCommand(process.platform, url);
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {
      /* swallowed — the URL is still in the tool result */
    });
    child.unref();
  } catch {
    /* swallowed — see above */
  }
}

export function registerAuthTools(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "auth_status",
    "Report whether the connector has Trello credentials configured and a persisted user token.",
    {},
    async () => {
      const configured = ctx.config !== null;
      const auth = configured ? await ctx.loadAuth() : null;
      return ok({
        configured,
        configError: ctx.configError,
        tokenStorePath: ctx.tokenStorePath,
        authenticated: auth !== null,
        scope: auth?.scope ?? null,
        expiration: auth?.expiration ?? null,
        obtainedAt: auth?.obtainedAt ?? null,
      });
    },
  );

  server.tool(
    "auth_login",
    "Run the OAuth 1.0a flow. Starts a local callback server, returns the authorize URL, and waits for the user to approve in their browser. The resulting token is persisted to the token store.",
    {
      scope: z
        .string()
        .default("read,write,account")
        .describe("Comma-separated Trello scopes: read, write, account."),
      expiration: z
        .enum(["1hour", "1day", "30days", "never"])
        .default("never")
        .describe("Trello token expiration window."),
      timeoutSeconds: z.number().int().positive().default(300),
      openBrowser: z
        .boolean()
        .default(true)
        .describe(
          "Whether to spawn the platform's default browser at the authorize URL. Set false in headless or test environments; the URL is still returned in the result.",
        ),
    },
    async (input) => {
      if (!ctx.config) return err(ctx.configError ?? "Trello connector not configured.");

      // Fixed port: Trello no longer accepts the `*` wildcard in Allowed
      // Origins, so the redirect origin must match an entry on the app-key
      // page exactly. The port comes from config (TRELLO_OAUTH_CALLBACK_PORT,
      // default 51823); register `http://127.0.0.1:<port>` over there.
      const cb = await startCallbackServer({
        port: ctx.config.oauthCallbackPort,
        timeoutMs: input.timeoutSeconds * 1000,
      });
      try {
        const requestToken = await fetchRequestToken(
          {
            consumerKey: ctx.config.consumerKey,
            consumerSecret: ctx.config.consumerSecret,
            appName: ctx.config.appName,
          },
          cb.url,
        );
        const authorizeUrl = requestToken.authorizeUrl({
          name: ctx.config.appName,
          scope: input.scope,
          expiration: input.expiration,
        });

        process.stderr.write(
          `\n[trello-mcp] authorize URL: ${authorizeUrl}\n`,
        );
        if (input.openBrowser) openInBrowser(authorizeUrl);

        const callback = await cb.result;
        if (callback.oauthToken !== requestToken.token) {
          return err("OAuth callback returned an unexpected oauth_token");
        }

        const access = await exchangeAccessToken(
          {
            consumerKey: ctx.config.consumerKey,
            consumerSecret: ctx.config.consumerSecret,
            appName: ctx.config.appName,
          },
          requestToken,
          callback.oauthVerifier,
        );

        const persisted: PersistedAuth = {
          token: access.token,
          tokenSecret: access.tokenSecret,
          consumerKey: ctx.config.consumerKey,
          obtainedAt: new Date().toISOString(),
          scope: input.scope,
          expiration: input.expiration,
        };
        await ctx.saveAuth(persisted);

        return ok({
          ok: true,
          authorizeUrl,
          tokenStorePath: ctx.tokenStorePath,
          scope: input.scope,
          expiration: input.expiration,
        });
      } finally {
        await cb.close();
      }
    },
  );

  server.tool(
    "auth_logout",
    "Delete the persisted Trello user token.",
    {},
    async () => {
      const removed = await ctx.clearAuth();
      return ok({ removed, tokenStorePath: ctx.tokenStorePath });
    },
  );
}

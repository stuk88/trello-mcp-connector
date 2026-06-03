import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  consumerKey: string;
  consumerSecret: string;
  appName: string;
  connectorHome: string;
  tokenStorePath: string;
  webhookPort: number;
  /**
   * Fixed port for the local OAuth callback server. Stable on purpose: Trello
   * no longer accepts the `*` wildcard in Allowed Origins, so the redirect
   * origin (`http://127.0.0.1:<oauthCallbackPort>`) must be registered as an
   * exact match on the app-key page.
   */
  oauthCallbackPort: number;
}

/**
 * Shared Trello app identity, bundled so the connector runs with zero env
 * setup. These authenticate the *application*, not any user's data — board
 * access comes from the per-user OAuth token minted by `auth_login`. Set the
 * matching env var to point the connector at a different Trello app.
 */
const BUNDLED_CONSUMER_KEY = "11edbb2c0b5be7cb5e12d4501d58c30f";
const BUNDLED_CONSUMER_SECRET =
  "8bf842d4e7a865f6d557937b1c5b1e9857a941701626477bd1173cf990a8e2c0";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const home = env.TRELLO_CONNECTOR_HOME ?? join(homedir(), ".trello-connector");
  return {
    consumerKey: env.TRELLO_CONSUMER_KEY || BUNDLED_CONSUMER_KEY,
    consumerSecret: env.TRELLO_CONSUMER_SECRET || BUNDLED_CONSUMER_SECRET,
    appName: env.TRELLO_APP_NAME ?? "Trello MCP Connector",
    connectorHome: home,
    tokenStorePath: join(home, "tokens.json"),
    webhookPort: Number(env.TRELLO_WEBHOOK_PORT ?? "4567"),
    oauthCallbackPort: Number(env.TRELLO_OAUTH_CALLBACK_PORT ?? "51823"),
  };
}

/**
 * Thin wrapper around loadConfig for the MCP server and webhook receiver. With
 * the app credentials bundled, config always loads; the {config, error} shape
 * is retained so the server's optional-config plumbing keeps its seam.
 */
export function tryLoadConfig(env: NodeJS.ProcessEnv = process.env): {
  config: Config | null;
  error: string | null;
} {
  try {
    return { config: loadConfig(env), error: null };
  } catch (e) {
    return { config: null, error: (e as Error).message };
  }
}

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

export class ConfigError extends Error {}

function readEnv(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (v && v.length > 0) return v;
  throw new ConfigError(`Missing required environment variable: ${name}`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const home = env.TRELLO_CONNECTOR_HOME ?? join(homedir(), ".trello-connector");
  return {
    consumerKey: readEnv(env, "TRELLO_CONSUMER_KEY"),
    consumerSecret: readEnv(env, "TRELLO_CONSUMER_SECRET"),
    appName: env.TRELLO_APP_NAME ?? "Trello MCP Connector",
    connectorHome: home,
    tokenStorePath: join(home, "tokens.json"),
    webhookPort: Number(env.TRELLO_WEBHOOK_PORT ?? "4567"),
    oauthCallbackPort: Number(env.TRELLO_OAUTH_CALLBACK_PORT ?? "51823"),
  };
}

/**
 * Lightweight, lazy variant used by the MCP server: defers env validation until
 * a tool that actually needs Trello credentials runs. This lets `auth_status`
 * report "not configured" without crashing process startup.
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

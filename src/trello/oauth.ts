import { parseOAuthFormBody, signRequest, type SigningCredentials } from "./signing.js";
import type { OAuthTokenPair } from "./types.js";

const REQUEST_TOKEN_URL = "https://trello.com/1/OAuthGetRequestToken";
const AUTHORIZE_URL = "https://trello.com/1/OAuthAuthorizeToken";
const ACCESS_TOKEN_URL = "https://trello.com/1/OAuthGetAccessToken";

export interface OAuthApp {
  consumerKey: string;
  consumerSecret: string;
  appName: string;
  fetchImpl?: typeof fetch;
}

export class OAuthError extends Error {
  constructor(stage: string, status: number, body: string) {
    super(`OAuth ${stage} failed: ${status} ${body.slice(0, 200)}`);
  }
}

export interface RequestTokenResult extends OAuthTokenPair {
  authorizeUrl: (opts: { name: string; scope: string; expiration: string }) => string;
}

export async function fetchRequestToken(
  app: OAuthApp,
  callbackUrl: string,
): Promise<RequestTokenResult> {
  const creds: SigningCredentials = {
    consumerKey: app.consumerKey,
    consumerSecret: app.consumerSecret,
  };
  const signed = signRequest(creds, {
    method: "POST",
    url: REQUEST_TOKEN_URL,
    extraOAuth: { oauth_callback: callbackUrl },
  });

  const res = await (app.fetchImpl ?? fetch)(REQUEST_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: signed.authorization },
  });
  const body = await res.text();
  if (!res.ok) throw new OAuthError("request token", res.status, body);

  const parsed = parseOAuthFormBody(body);
  const token = parsed.oauth_token;
  const tokenSecret = parsed.oauth_token_secret;
  if (!token || !tokenSecret) {
    throw new OAuthError("request token", res.status, `missing token in: ${body}`);
  }

  return {
    token,
    tokenSecret,
    authorizeUrl: ({ name, scope, expiration }) => {
      const u = new URL(AUTHORIZE_URL);
      u.searchParams.set("oauth_token", token);
      u.searchParams.set("name", name);
      u.searchParams.set("scope", scope);
      u.searchParams.set("expiration", expiration);
      return u.toString();
    },
  };
}

export async function exchangeAccessToken(
  app: OAuthApp,
  requestToken: OAuthTokenPair,
  verifier: string,
): Promise<OAuthTokenPair> {
  const creds: SigningCredentials = {
    consumerKey: app.consumerKey,
    consumerSecret: app.consumerSecret,
    token: requestToken.token,
    tokenSecret: requestToken.tokenSecret,
  };
  const signed = signRequest(creds, {
    method: "POST",
    url: ACCESS_TOKEN_URL,
    extraOAuth: { oauth_verifier: verifier },
  });

  const res = await (app.fetchImpl ?? fetch)(ACCESS_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: signed.authorization },
  });
  const body = await res.text();
  if (!res.ok) throw new OAuthError("access token", res.status, body);

  const parsed = parseOAuthFormBody(body);
  const token = parsed.oauth_token;
  const tokenSecret = parsed.oauth_token_secret;
  if (!token || !tokenSecret) {
    throw new OAuthError("access token", res.status, `missing token in: ${body}`);
  }
  return { token, tokenSecret };
}

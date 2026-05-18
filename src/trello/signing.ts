import { createHmac, randomBytes } from "node:crypto";

export interface SigningCredentials {
  consumerKey: string;
  consumerSecret: string;
  token?: string;
  tokenSecret?: string;
}

export interface SignedRequest {
  method: string;
  url: string;
  authorization: string;
}

export interface SignOptions {
  method: string;
  url: string;
  params?: Record<string, string | number | boolean | undefined>;
  extraOAuth?: Record<string, string>;
  nonce?: string;
  timestamp?: string;
}

/**
 * RFC 5849 §3.6: percent-encode unreserved characters per RFC 3986.
 * Note: encodeURIComponent leaves !'()* unescaped — we patch those.
 */
export function rfc3986Encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function collectParams(
  url: URL,
  extra: Record<string, string | number | boolean | undefined>,
): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of url.searchParams.entries()) out.push([k, v]);
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) continue;
    out.push([k, String(v)]);
  }
  return out;
}

export function buildSignatureBaseString(opts: {
  method: string;
  url: string;
  params: Record<string, string | number | boolean | undefined>;
  oauthParams: Record<string, string>;
}): { baseString: string; baseUrl: string; allParams: Array<[string, string]> } {
  const parsed = new URL(opts.url);
  const baseUrl = `${parsed.protocol}//${parsed.host.toLowerCase()}${parsed.pathname}`;

  const all = [
    ...collectParams(parsed, opts.params),
    ...Object.entries(opts.oauthParams),
  ];

  const encoded: Array<[string, string]> = all
    .map(([k, v]): [string, string] => [rfc3986Encode(k), rfc3986Encode(v)])
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));

  const paramString = encoded.map(([k, v]) => `${k}=${v}`).join("&");

  const baseString = [
    opts.method.toUpperCase(),
    rfc3986Encode(baseUrl),
    rfc3986Encode(paramString),
  ].join("&");

  return { baseString, baseUrl, allParams: encoded };
}

export function signRequest(
  creds: SigningCredentials,
  opts: SignOptions,
): SignedRequest {
  const nonce = opts.nonce ?? randomBytes(16).toString("hex");
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000).toString();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_version: "1.0",
    ...(creds.token ? { oauth_token: creds.token } : {}),
    ...(opts.extraOAuth ?? {}),
  };

  const { baseString } = buildSignatureBaseString({
    method: opts.method,
    url: opts.url,
    params: opts.params ?? {},
    oauthParams,
  });

  const signingKey = `${rfc3986Encode(creds.consumerSecret)}&${rfc3986Encode(
    creds.tokenSecret ?? "",
  )}`;

  const signature = createHmac("sha1", signingKey).update(baseString).digest("base64");
  const signedOAuth = { ...oauthParams, oauth_signature: signature };

  const authorization =
    "OAuth " +
    Object.entries(signedOAuth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${rfc3986Encode(k)}="${rfc3986Encode(v)}"`)
      .join(", ");

  return { method: opts.method.toUpperCase(), url: opts.url, authorization };
}

export function parseOAuthFormBody(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq === -1) {
      out[decodeURIComponent(part)] = "";
    } else {
      out[decodeURIComponent(part.slice(0, eq))] = decodeURIComponent(
        part.slice(eq + 1),
      );
    }
  }
  return out;
}

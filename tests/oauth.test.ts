import { describe, expect, it } from "vitest";
import { exchangeAccessToken, fetchRequestToken } from "../src/trello/oauth.js";

function mockFetch(responses: Array<{ status?: number; body: string }>): {
  fetch: typeof fetch;
  calls: Array<{ url: string; auth: string | undefined }>;
} {
  const calls: Array<{ url: string; auth: string | undefined }> = [];
  let i = 0;
  const fetchImpl = (async (input: Request | URL | string, init?: RequestInit) => {
    const urlStr =
      input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({ url: urlStr, auth: headers?.Authorization });
    const r = responses[i++] ?? { status: 500, body: "no mock left" };
    return new Response(r.body, { status: r.status ?? 200, statusText: "OK" });
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

describe("fetchRequestToken", () => {
  it("posts to /1/OAuthGetRequestToken with oauth_callback in the Authorization header and parses the form body", async () => {
    const { fetch, calls } = mockFetch([
      {
        body:
          "oauth_token=REQ-TOKEN&oauth_token_secret=REQ-SECRET&oauth_callback_confirmed=true",
      },
    ]);
    const req = await fetchRequestToken(
      { consumerKey: "ck", consumerSecret: "cs", appName: "Test", fetchImpl: fetch },
      "http://localhost:1234/cb",
    );
    expect(req.token).toBe("REQ-TOKEN");
    expect(req.tokenSecret).toBe("REQ-SECRET");
    expect(calls[0]!.url).toBe("https://trello.com/1/OAuthGetRequestToken");
    expect(calls[0]!.auth).toMatch(/^OAuth /);
    expect(calls[0]!.auth).toContain("oauth_callback=");
    expect(calls[0]!.auth).toContain("oauth_consumer_key=\"ck\"");

    // authorizeUrl builds with the requested scope/expiration
    const authorize = req.authorizeUrl({ name: "Test", scope: "read,write", expiration: "never" });
    expect(authorize).toBe(
      "https://trello.com/1/OAuthAuthorizeToken?oauth_token=REQ-TOKEN&name=Test&scope=read%2Cwrite&expiration=never",
    );
  });

  it("throws OAuthError on non-2xx", async () => {
    const { fetch } = mockFetch([{ status: 401, body: "bad app" }]);
    await expect(
      fetchRequestToken(
        { consumerKey: "ck", consumerSecret: "cs", appName: "Test", fetchImpl: fetch },
        "http://localhost:1234/cb",
      ),
    ).rejects.toThrow(/OAuth request token failed/);
  });
});

describe("exchangeAccessToken", () => {
  it("includes oauth_verifier in the signed request and returns the persistent token", async () => {
    const { fetch, calls } = mockFetch([
      { body: "oauth_token=ACCESS&oauth_token_secret=ACCESS-SECRET" },
    ]);
    const result = await exchangeAccessToken(
      { consumerKey: "ck", consumerSecret: "cs", appName: "Test", fetchImpl: fetch },
      { token: "REQ-TOKEN", tokenSecret: "REQ-SECRET" },
      "verifier-xyz",
    );
    expect(result).toEqual({ token: "ACCESS", tokenSecret: "ACCESS-SECRET" });
    expect(calls[0]!.url).toBe("https://trello.com/1/OAuthGetAccessToken");
    expect(calls[0]!.auth).toContain("oauth_verifier=\"verifier-xyz\"");
    expect(calls[0]!.auth).toContain("oauth_token=\"REQ-TOKEN\"");
  });
});

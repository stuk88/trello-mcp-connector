import { describe, expect, it } from "vitest";
import { TrelloApiError, TrelloClient } from "../src/trello/client.js";

interface RecordedCall {
  url: string;
  method: string;
  authorization: string | undefined;
  accept: string | undefined;
}

function mockFetch(
  responses: Array<{ status?: number; body: string; statusText?: string }>,
): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let i = 0;
  const fetchImpl = (async (input: Request | URL | string, init?: RequestInit) => {
    const urlStr =
      input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({
      url: urlStr,
      method: init?.method ?? "GET",
      authorization: headers?.Authorization,
      accept: headers?.Accept,
    });
    const r = responses[i++] ?? { status: 500, body: "no mock response left" };
    return new Response(r.body, {
      status: r.status ?? 200,
      statusText: r.statusText ?? "OK",
    });
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

const creds = {
  consumerKey: "ck",
  consumerSecret: "cs",
  token: "tk",
  tokenSecret: "ts",
};

describe("TrelloClient", () => {
  it("listBoards builds a signed GET against /members/me/boards with default filter and fields", async () => {
    const boards = [{ id: "b1", name: "Demo" }];
    const { fetch, calls } = mockFetch([{ body: JSON.stringify(boards) }]);
    const client = new TrelloClient({ creds, fetchImpl: fetch });
    const result = await client.listBoards();
    expect(result).toEqual(boards);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.method).toBe("GET");
    expect(call.url).toContain("https://api.trello.com/1/members/me/boards");
    expect(call.url).toContain("filter=open");
    expect(call.url).toContain("fields=");
    expect(call.authorization).toMatch(/^OAuth /);
    expect(call.authorization).toContain('oauth_consumer_key="ck"');
    expect(call.authorization).toContain('oauth_token="tk"');
    expect(call.authorization).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(call.authorization).toContain('oauth_signature="');
  });

  it("createCard POSTs to /cards with merged params and joined arrays", async () => {
    const created = { id: "c1", name: "Buy milk" };
    const { fetch, calls } = mockFetch([{ body: JSON.stringify(created) }]);
    const client = new TrelloClient({ creds, fetchImpl: fetch });
    const result = await client.createCard({
      idList: "list-1",
      name: "Buy milk",
      idMembers: ["m1", "m2"],
      idLabels: ["l1"],
    });
    expect(result).toEqual(created);
    const call = calls[0]!;
    expect(call.method).toBe("POST");
    const url = new URL(call.url);
    expect(url.pathname).toBe("/1/cards");
    expect(url.searchParams.get("idList")).toBe("list-1");
    expect(url.searchParams.get("name")).toBe("Buy milk");
    expect(url.searchParams.get("idMembers")).toBe("m1,m2");
    expect(url.searchParams.get("idLabels")).toBe("l1");
  });

  it("deleteCard issues a DELETE and tolerates empty body", async () => {
    const { fetch, calls } = mockFetch([{ body: "" }]);
    const client = new TrelloClient({ creds, fetchImpl: fetch });
    await client.deleteCard("card-1");
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toContain("/cards/card-1");
  });

  it("listWebhooks queries /tokens/<token>/webhooks", async () => {
    const hooks = [{ id: "h1", idModel: "b1", callbackURL: "https://x", active: true }];
    const { fetch, calls } = mockFetch([{ body: JSON.stringify(hooks) }]);
    const client = new TrelloClient({ creds, fetchImpl: fetch });
    const result = await client.listWebhooks("tk");
    expect(result).toEqual(hooks);
    expect(calls[0]!.url).toContain("/tokens/tk/webhooks");
  });

  it("propagates non-2xx as TrelloApiError with status + body", async () => {
    const { fetch } = mockFetch([
      { status: 401, statusText: "Unauthorized", body: "invalid token" },
    ]);
    const client = new TrelloClient({ creds, fetchImpl: fetch });
    let caught: unknown;
    try {
      await client.me();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TrelloApiError);
    const err = caught as TrelloApiError;
    expect(err.status).toBe(401);
    expect(err.body).toBe("invalid token");
    expect(err.message).toContain("invalid token");
  });

  it("strips undefined params before signing (e.g. optional desc)", async () => {
    const { fetch, calls } = mockFetch([{ body: JSON.stringify({ id: "c2" }) }]);
    const client = new TrelloClient({ creds, fetchImpl: fetch });
    await client.createCard({ idList: "list-1", name: "Just a name" });
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.has("desc")).toBe(false);
    expect(url.searchParams.has("due")).toBe(false);
    expect(url.searchParams.has("pos")).toBe(false);
  });
});

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

  it("attachUrl POSTs url + metadata to /cards/<id>/attachments", async () => {
    const att = { id: "att1", url: "https://e.com/i.png", name: "img" };
    const { fetch, calls } = mockFetch([{ body: JSON.stringify(att) }]);
    const client = new TrelloClient({ creds, fetchImpl: fetch });
    const result = await client.attachUrl("card-1", {
      url: "https://e.com/i.png",
      name: "img",
      setCover: true,
    });
    expect(result).toEqual(att);
    const call = calls[0]!;
    expect(call.method).toBe("POST");
    const url = new URL(call.url);
    expect(url.pathname).toBe("/1/cards/card-1/attachments");
    expect(url.searchParams.get("url")).toBe("https://e.com/i.png");
    expect(url.searchParams.get("name")).toBe("img");
    expect(url.searchParams.get("setCover")).toBe("true");
    expect(call.authorization).toMatch(/^OAuth /);
  });

  it("attachFile puts the file in a multipart body, metadata in the signed query, file NOT signed", async () => {
    const created = { id: "att2", name: "shot.png", isUpload: true };
    let captured:
      | { url: string; method: string; auth: string | undefined; body: unknown }
      | null = null;
    const fetchImpl = (async (input: Request | URL | string, init?: RequestInit) => {
      const urlStr =
        input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
      const headers = init?.headers as Record<string, string> | undefined;
      captured = {
        url: urlStr,
        method: init?.method ?? "GET",
        auth: headers?.Authorization,
        body: init?.body,
      };
      return new Response(JSON.stringify(created), { status: 200, statusText: "OK" });
    }) as unknown as typeof fetch;

    const client = new TrelloClient({ creds, fetchImpl });
    const result = await client.attachFile(
      "card-1",
      { data: Buffer.from("DISTINCTIVE_FILE_BYTES"), filename: "shot.png", mimeType: "image/png" },
      { name: "Screenshot", setCover: true },
    );
    expect(result).toEqual(created);
    expect(captured).not.toBeNull();
    const cap = captured!;
    expect(cap.method).toBe("POST");
    const url = new URL(cap.url);
    expect(url.pathname).toBe("/1/cards/card-1/attachments");
    expect(url.searchParams.get("name")).toBe("Screenshot");
    expect(url.searchParams.get("mimeType")).toBe("image/png");
    expect(url.searchParams.get("setCover")).toBe("true");
    // The signed material is metadata-only: the query carries exactly the three
    // metadata params (no `file`), and the file's bytes appear nowhere in the
    // OAuth Authorization header — i.e. the file is genuinely excluded from the
    // signature base string, not merely absent from the query.
    expect([...url.searchParams.keys()].sort()).toEqual(["mimeType", "name", "setCover"]);
    expect(cap.auth).toMatch(/^OAuth /);
    expect(cap.auth).toContain('oauth_signature="');
    expect(cap.auth).not.toContain("DISTINCTIVE");
    // ...and it must ride in the multipart body with the right filename + bytes.
    expect(cap.body).toBeInstanceOf(FormData);
    const filePart = (cap.body as FormData).get("file");
    expect(filePart).toBeInstanceOf(Blob);
    expect((filePart as File).name).toBe("shot.png");
    expect(await (filePart as File).text()).toBe("DISTINCTIVE_FILE_BYTES");
  });

  it("listAttachments / deleteAttachment hit the attachment subresource paths", async () => {
    const { fetch, calls } = mockFetch([{ body: "[]" }, { body: "" }]);
    const client = new TrelloClient({ creds, fetchImpl: fetch });
    await client.listAttachments("card-1");
    await client.deleteAttachment("card-1", "att-9");
    expect(calls[0]!.method).toBe("GET");
    expect(new URL(calls[0]!.url).pathname).toBe("/1/cards/card-1/attachments");
    expect(calls[1]!.method).toBe("DELETE");
    expect(new URL(calls[1]!.url).pathname).toBe("/1/cards/card-1/attachments/att-9");
  });

  it("createChecklist POSTs /checklists with idCard; listChecklists GETs the card subresource", async () => {
    const { fetch, calls } = mockFetch([
      { body: JSON.stringify({ id: "cl1", name: "Steps" }) },
      { body: "[]" },
    ]);
    const client = new TrelloClient({ creds, fetchImpl: fetch });
    await client.createChecklist("card-1", { name: "Steps" });
    await client.listChecklists("card-1");
    const create = new URL(calls[0]!.url);
    expect(calls[0]!.method).toBe("POST");
    expect(create.pathname).toBe("/1/checklists");
    expect(create.searchParams.get("idCard")).toBe("card-1");
    expect(create.searchParams.get("name")).toBe("Steps");
    expect(calls[1]!.method).toBe("GET");
    expect(new URL(calls[1]!.url).pathname).toBe("/1/cards/card-1/checklists");
  });

  it("addCheckItem POSTs checked; updateCheckItem PUTs state on the card path", async () => {
    const { fetch, calls } = mockFetch([
      { body: JSON.stringify({ id: "ci1" }) },
      { body: JSON.stringify({ id: "ci1", state: "complete" }) },
    ]);
    const client = new TrelloClient({ creds, fetchImpl: fetch });
    await client.addCheckItem("cl1", { name: "do it", checked: true });
    await client.updateCheckItem("card-1", "ci1", { state: "complete" });
    const add = new URL(calls[0]!.url);
    expect(calls[0]!.method).toBe("POST");
    expect(add.pathname).toBe("/1/checklists/cl1/checkItems");
    expect(add.searchParams.get("name")).toBe("do it");
    expect(add.searchParams.get("checked")).toBe("true");
    const upd = new URL(calls[1]!.url);
    expect(calls[1]!.method).toBe("PUT");
    expect(upd.pathname).toBe("/1/cards/card-1/checkItem/ci1");
    expect(upd.searchParams.get("state")).toBe("complete");
  });

  it("deleteCheckItem / deleteChecklist DELETE the right paths", async () => {
    const { fetch, calls } = mockFetch([{ body: "" }, { body: "" }]);
    const client = new TrelloClient({ creds, fetchImpl: fetch });
    await client.deleteCheckItem("cl1", "ci1");
    await client.deleteChecklist("cl1");
    expect(calls[0]!.method).toBe("DELETE");
    expect(new URL(calls[0]!.url).pathname).toBe("/1/checklists/cl1/checkItems/ci1");
    expect(calls[1]!.method).toBe("DELETE");
    expect(new URL(calls[1]!.url).pathname).toBe("/1/checklists/cl1");
  });

  it("addComment POSTs text to /cards/<id>/actions/comments; listComments filters commentCard", async () => {
    const { fetch, calls } = mockFetch([{ body: JSON.stringify({ id: "a1" }) }, { body: "[]" }]);
    const client = new TrelloClient({ creds, fetchImpl: fetch });
    await client.addComment("card-1", "nice work");
    await client.listComments("card-1");
    const add = new URL(calls[0]!.url);
    expect(calls[0]!.method).toBe("POST");
    expect(add.pathname).toBe("/1/cards/card-1/actions/comments");
    expect(add.searchParams.get("text")).toBe("nice work");
    const list = new URL(calls[1]!.url);
    expect(calls[1]!.method).toBe("GET");
    expect(list.pathname).toBe("/1/cards/card-1/actions");
    expect(list.searchParams.get("filter")).toBe("commentCard");
  });

  it("updateComment PUTs and deleteComment DELETEs the action comment subresource", async () => {
    const { fetch, calls } = mockFetch([{ body: JSON.stringify({ id: "a1" }) }, { body: "" }]);
    const client = new TrelloClient({ creds, fetchImpl: fetch });
    await client.updateComment("card-1", "a1", "edited");
    await client.deleteComment("card-1", "a1");
    expect(calls[0]!.method).toBe("PUT");
    expect(new URL(calls[0]!.url).pathname).toBe("/1/cards/card-1/actions/a1/comments");
    expect(new URL(calls[0]!.url).searchParams.get("text")).toBe("edited");
    expect(calls[1]!.method).toBe("DELETE");
    expect(new URL(calls[1]!.url).pathname).toBe("/1/cards/card-1/actions/a1/comments");
  });
});

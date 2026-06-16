import { signRequest, type SigningCredentials } from "./signing.js";
import type {
  Attachment,
  Board,
  Card,
  CheckItem,
  Checklist,
  CommentAction,
  List,
  Member,
  Webhook,
} from "./types.js";

export class TrelloApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: string,
    public readonly url: string,
  ) {
    super(`Trello API ${status} ${statusText} for ${url}: ${body.slice(0, 200)}`);
  }
}

export interface TrelloClientOptions {
  creds: SigningCredentials;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

type Method = "GET" | "POST" | "PUT" | "DELETE";

const DEFAULT_BASE = "https://api.trello.com/1";

export class TrelloClient {
  private readonly creds: SigningCredentials;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: TrelloClientOptions) {
    this.creds = opts.creds;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async request<T>(
    method: Method,
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const filtered: Record<string, string | number | boolean | undefined> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) filtered[k] = v;
    }
    const signed = signRequest(this.creds, { method, url, params: filtered });

    const target = new URL(url);
    for (const [k, v] of Object.entries(filtered)) {
      target.searchParams.set(k, String(v));
    }

    const res = await this.fetchImpl(target.toString(), {
      method,
      headers: { Authorization: signed.authorization, Accept: "application/json" },
    });

    return this.readBody<T>(res, target.toString());
  }

  private async readBody<T>(res: Response, url: string): Promise<T> {
    const text = await res.text();
    if (!res.ok) {
      throw new TrelloApiError(res.status, res.statusText, text, url);
    }
    if (text.length === 0) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  me(): Promise<Member> {
    return this.request<Member>("GET", "/members/me");
  }

  listBoards(params: { filter?: string; fields?: string } = {}): Promise<Board[]> {
    return this.request<Board[]>("GET", "/members/me/boards", {
      filter: params.filter ?? "open",
      fields: params.fields ?? "id,name,desc,closed,url,shortUrl,idOrganization,dateLastActivity",
    });
  }

  listOrgBoards(
    orgId: string,
    params: { filter?: string; fields?: string } = {},
  ): Promise<Board[]> {
    return this.request<Board[]>(
      "GET",
      `/organizations/${encodeURIComponent(orgId)}/boards`,
      {
        filter: params.filter ?? "open",
        fields: params.fields ?? "id,name,desc,closed,url,shortUrl,idOrganization,dateLastActivity",
      },
    );
  }

  getBoard(
    id: string,
    params: { lists?: "all" | "open" | "closed" | "none"; cards?: "all" | "open" | "closed" | "none" } = {},
  ): Promise<Board & { lists?: List[]; cards?: Card[] }> {
    return this.request("GET", `/boards/${encodeURIComponent(id)}`, {
      lists: params.lists ?? "none",
      cards: params.cards ?? "none",
    });
  }

  listLists(boardId: string, filter: "all" | "open" | "closed" = "open"): Promise<List[]> {
    return this.request<List[]>("GET", `/boards/${encodeURIComponent(boardId)}/lists`, { filter });
  }

  createList(boardId: string, name: string, pos?: string | number): Promise<List> {
    return this.request<List>("POST", "/lists", {
      idBoard: boardId,
      name,
      pos,
    });
  }

  updateList(
    listId: string,
    patch: { name?: string; closed?: boolean; pos?: string | number; idBoard?: string },
  ): Promise<List> {
    return this.request<List>("PUT", `/lists/${encodeURIComponent(listId)}`, patch);
  }

  listCards(listId: string): Promise<Card[]> {
    return this.request<Card[]>("GET", `/lists/${encodeURIComponent(listId)}/cards`);
  }

  getCard(cardId: string): Promise<Card> {
    return this.request<Card>("GET", `/cards/${encodeURIComponent(cardId)}`, {
      fields: "all",
    });
  }

  createCard(input: {
    idList: string;
    name: string;
    desc?: string;
    due?: string;
    idMembers?: string[];
    idLabels?: string[];
    pos?: string | number;
  }): Promise<Card> {
    return this.request<Card>("POST", "/cards", {
      idList: input.idList,
      name: input.name,
      desc: input.desc,
      due: input.due,
      idMembers: input.idMembers?.join(","),
      idLabels: input.idLabels?.join(","),
      pos: input.pos,
    });
  }

  updateCard(
    cardId: string,
    patch: {
      name?: string;
      desc?: string;
      closed?: boolean;
      idList?: string;
      due?: string | null;
      dueComplete?: boolean;
      idMembers?: string[];
      idLabels?: string[];
      pos?: string | number;
    },
  ): Promise<Card> {
    // Trello accepts an empty string for `due` to clear the due date.
    const { due, idMembers, idLabels, ...rest } = patch;
    return this.request<Card>("PUT", `/cards/${encodeURIComponent(cardId)}`, {
      ...rest,
      due: due === null ? "" : due,
      idMembers: idMembers?.join(","),
      idLabels: idLabels?.join(","),
    });
  }

  deleteCard(cardId: string): Promise<void> {
    return this.request<void>("DELETE", `/cards/${encodeURIComponent(cardId)}`);
  }

  listAttachments(cardId: string): Promise<Attachment[]> {
    return this.request<Attachment[]>(
      "GET",
      `/cards/${encodeURIComponent(cardId)}/attachments`,
    );
  }

  attachUrl(
    cardId: string,
    input: { url: string; name?: string; setCover?: boolean },
  ): Promise<Attachment> {
    return this.request<Attachment>(
      "POST",
      `/cards/${encodeURIComponent(cardId)}/attachments`,
      { url: input.url, name: input.name, setCover: input.setCover },
    );
  }

  async attachFile(
    cardId: string,
    file: { data: Buffer; filename: string; mimeType?: string },
    opts: { name?: string; setCover?: boolean } = {},
  ): Promise<Attachment> {
    const url = `${this.baseUrl}/cards/${encodeURIComponent(cardId)}/attachments`;
    // Metadata is signed and travels in the query string; the file rides in the
    // multipart body, which RFC 5849 §3.4.1.3 excludes from the signature base
    // string (only urlencoded bodies participate). Content-Type is intentionally
    // unset so FormData supplies the multipart boundary.
    const filtered: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries({
      name: opts.name,
      mimeType: file.mimeType,
      setCover: opts.setCover,
    })) {
      if (v !== undefined) filtered[k] = v;
    }
    const signed = signRequest(this.creds, { method: "POST", url, params: filtered });
    const target = new URL(url);
    for (const [k, v] of Object.entries(filtered)) {
      target.searchParams.set(k, String(v));
    }
    const form = new FormData();
    // Re-wrap into a fresh ArrayBuffer-backed view: Node's Buffer is typed as
    // ArrayBufferLike-backed, which is not assignable to the DOM BlobPart type.
    const bytes = new Uint8Array(file.data);
    const blob = file.mimeType
      ? new Blob([bytes], { type: file.mimeType })
      : new Blob([bytes]);
    form.append("file", blob, file.filename);
    const res = await this.fetchImpl(target.toString(), {
      method: "POST",
      headers: { Authorization: signed.authorization, Accept: "application/json" },
      body: form,
    });
    return this.readBody<Attachment>(res, target.toString());
  }

  deleteAttachment(cardId: string, attachmentId: string): Promise<void> {
    return this.request<void>(
      "DELETE",
      `/cards/${encodeURIComponent(cardId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
  }

  listChecklists(cardId: string): Promise<Checklist[]> {
    return this.request<Checklist[]>(
      "GET",
      `/cards/${encodeURIComponent(cardId)}/checklists`,
    );
  }

  createChecklist(
    cardId: string,
    input: { name: string; pos?: string | number },
  ): Promise<Checklist> {
    return this.request<Checklist>("POST", "/checklists", {
      idCard: cardId,
      name: input.name,
      pos: input.pos,
    });
  }

  deleteChecklist(checklistId: string): Promise<void> {
    return this.request<void>(
      "DELETE",
      `/checklists/${encodeURIComponent(checklistId)}`,
    );
  }

  addCheckItem(
    checklistId: string,
    input: { name: string; checked?: boolean; pos?: string | number },
  ): Promise<CheckItem> {
    return this.request<CheckItem>(
      "POST",
      `/checklists/${encodeURIComponent(checklistId)}/checkItems`,
      { name: input.name, checked: input.checked, pos: input.pos },
    );
  }

  updateCheckItem(
    cardId: string,
    checkItemId: string,
    patch: { name?: string; state?: "complete" | "incomplete"; pos?: string | number },
  ): Promise<CheckItem> {
    return this.request<CheckItem>(
      "PUT",
      `/cards/${encodeURIComponent(cardId)}/checkItem/${encodeURIComponent(checkItemId)}`,
      { name: patch.name, state: patch.state, pos: patch.pos },
    );
  }

  deleteCheckItem(checklistId: string, checkItemId: string): Promise<void> {
    return this.request<void>(
      "DELETE",
      `/checklists/${encodeURIComponent(checklistId)}/checkItems/${encodeURIComponent(checkItemId)}`,
    );
  }

  listComments(cardId: string): Promise<CommentAction[]> {
    return this.request<CommentAction[]>(
      "GET",
      `/cards/${encodeURIComponent(cardId)}/actions`,
      { filter: "commentCard" },
    );
  }

  addComment(cardId: string, text: string): Promise<CommentAction> {
    return this.request<CommentAction>(
      "POST",
      `/cards/${encodeURIComponent(cardId)}/actions/comments`,
      { text },
    );
  }

  updateComment(
    cardId: string,
    commentId: string,
    text: string,
  ): Promise<CommentAction> {
    return this.request<CommentAction>(
      "PUT",
      `/cards/${encodeURIComponent(cardId)}/actions/${encodeURIComponent(commentId)}/comments`,
      { text },
    );
  }

  deleteComment(cardId: string, commentId: string): Promise<void> {
    return this.request<void>(
      "DELETE",
      `/cards/${encodeURIComponent(cardId)}/actions/${encodeURIComponent(commentId)}/comments`,
    );
  }

  listWebhooks(tokenForOwner: string): Promise<Webhook[]> {
    return this.request<Webhook[]>(
      "GET",
      `/tokens/${encodeURIComponent(tokenForOwner)}/webhooks`,
    );
  }

  createWebhook(input: {
    idModel: string;
    callbackURL: string;
    description?: string;
    active?: boolean;
  }): Promise<Webhook> {
    return this.request<Webhook>("POST", "/webhooks", {
      idModel: input.idModel,
      callbackURL: input.callbackURL,
      description: input.description,
      active: input.active ?? true,
    });
  }

  deleteWebhook(webhookId: string): Promise<void> {
    return this.request<void>("DELETE", `/webhooks/${encodeURIComponent(webhookId)}`);
  }
}

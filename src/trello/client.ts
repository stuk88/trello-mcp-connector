import { signRequest, type SigningCredentials } from "./signing.js";
import type { Board, Card, List, Member, Webhook } from "./types.js";

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

    const text = await res.text();
    if (!res.ok) {
      throw new TrelloApiError(res.status, res.statusText, text, target.toString());
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

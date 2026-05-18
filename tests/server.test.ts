import { mkdtemp, readFile, rm, writeFile as fsWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";
import { TokenStore } from "../src/auth/store.js";
import type { Config } from "../src/config.js";
import type { LoadedProjectConfig, ProjectConfig } from "../src/project-config.js";

const EMPTY_PROJECT_CONFIG: LoadedProjectConfig = {
  config: null,
  sourcePath: null,
  error: null,
};

function withProjectConfig(config: ProjectConfig): LoadedProjectConfig {
  return { config, sourcePath: "/fake/trello.config.json", error: null };
}

interface FetchCall {
  url: string;
  method: string;
  authorization: string | undefined;
}

function mockFetch(responses: Array<{ status?: number; body: string }>): {
  fetch: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  let i = 0;
  const fetchImpl = (async (input: Request | URL | string, init?: RequestInit) => {
    const url =
      input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({ url, method: init?.method ?? "GET", authorization: headers?.Authorization });
    const r = responses[i++] ?? { status: 500, body: "no mock left" };
    return new Response(r.body, { status: r.status ?? 200, statusText: "OK" });
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

async function bootClient(opts: {
  config: Config | null;
  configError?: string | null;
  fetchImpl?: typeof fetch;
  projectConfig?: LoadedProjectConfig;
  listCachePath?: string;
}): Promise<{ client: Client; close: () => Promise<void> }> {
  const { server } = buildServer({
    config: opts.config,
    configError: opts.configError ?? null,
    fetchImpl: opts.fetchImpl,
    projectConfig: opts.projectConfig ?? EMPTY_PROJECT_CONFIG,
    listCachePath: opts.listCachePath,
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  const part = result.content.find((c) => c.type === "text");
  return part?.text ?? "";
}

describe("Trello MCP server (end-to-end)", () => {
  let dir: string;
  let tokenPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "trello-mcp-"));
    tokenPath = join(dir, "tokens.json");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function makeConfig(overrides: Partial<Config> = {}): Config {
    return {
      consumerKey: "ck",
      consumerSecret: "cs",
      appName: "Test",
      connectorHome: dir,
      tokenStorePath: tokenPath,
      webhookPort: 4567,
      oauthCallbackPort: 0,
      ...overrides,
    };
  }

  it("lists all expected tools (incl. project_config)", async () => {
    const { client, close } = await bootClient({ config: makeConfig() });
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual(
        [
          "auth_login",
          "auth_logout",
          "auth_status",
          "cache_board_lists",
          "create_card",
          "create_list",
          "create_webhook",
          "delete_card",
          "delete_webhook",
          "get_board",
          "get_card",
          "list_boards",
          "list_cards",
          "list_lists",
          "list_webhooks",
          "move_card_by_status",
          "project_config",
          "update_card",
          "update_list",
        ].sort(),
      );
    } finally {
      await close();
    }
  });

  it("auth_status reports not-authenticated before login", async () => {
    const { client, close } = await bootClient({ config: makeConfig() });
    try {
      const res = await client.callTool({ name: "auth_status", arguments: {} });
      const parsed = JSON.parse(textOf(res as never));
      expect(parsed.configured).toBe(true);
      expect(parsed.authenticated).toBe(false);
    } finally {
      await close();
    }
  });

  it("list_boards calls Trello with a signed Authorization header", async () => {
    // Pre-seed a persisted token so the client can be built.
    const store = new TokenStore(tokenPath);
    await store.save({
      token: "tk",
      tokenSecret: "ts",
      consumerKey: "ck",
      obtainedAt: new Date().toISOString(),
      scope: "read,write",
      expiration: "never",
    });

    const boards = [{ id: "b1", name: "Demo" }];
    const { fetch, calls } = mockFetch([{ body: JSON.stringify(boards) }]);
    const { client, close } = await bootClient({
      config: makeConfig(),
      fetchImpl: fetch,
    });
    try {
      const res = await client.callTool({ name: "list_boards", arguments: { filter: "open" } });
      expect(JSON.parse(textOf(res as never))).toEqual(boards);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toContain("/members/me/boards");
      expect(calls[0]!.authorization).toMatch(/^OAuth /);
      expect(calls[0]!.authorization).toContain('oauth_token="tk"');
    } finally {
      await close();
    }
  });

  it("create_card produces a POST to /1/cards with idMembers joined", async () => {
    const store = new TokenStore(tokenPath);
    await store.save({
      token: "tk",
      tokenSecret: "ts",
      consumerKey: "ck",
      obtainedAt: new Date().toISOString(),
      scope: "read,write",
      expiration: "never",
    });

    const created = { id: "c1", name: "Buy milk", idMembers: ["m1", "m2"] };
    const { fetch, calls } = mockFetch([{ body: JSON.stringify(created) }]);
    const { client, close } = await bootClient({ config: makeConfig(), fetchImpl: fetch });
    try {
      const res = await client.callTool({
        name: "create_card",
        arguments: { listId: "list-1", name: "Buy milk", idMembers: ["m1", "m2"] },
      });
      expect(JSON.parse(textOf(res as never))).toEqual(created);
      expect(calls[0]!.method).toBe("POST");
      const url = new URL(calls[0]!.url);
      expect(url.pathname).toBe("/1/cards");
      expect(url.searchParams.get("idMembers")).toBe("m1,m2");
    } finally {
      await close();
    }
  });

  it("surfaces Trello 401 as an MCP tool error result", async () => {
    const store = new TokenStore(tokenPath);
    await store.save({
      token: "tk",
      tokenSecret: "ts",
      consumerKey: "ck",
      obtainedAt: new Date().toISOString(),
      scope: "read,write",
      expiration: "never",
    });
    const { fetch } = mockFetch([{ status: 401, body: "invalid token" }]);
    const { client, close } = await bootClient({ config: makeConfig(), fetchImpl: fetch });
    try {
      const result = (await client.callTool({
        name: "list_boards",
        arguments: { filter: "open" },
      })) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
      expect(result.isError).toBe(true);
      expect(textOf(result as never)).toMatch(/Trello API 401/);
      expect(textOf(result as never)).toMatch(/invalid token/);
    } finally {
      await close();
    }
  });

  describe("project config fallbacks", () => {
    async function seededAuthClient(
      projectConfig: LoadedProjectConfig,
      responses: Array<{ status?: number; body: string }>,
    ) {
      const store = new TokenStore(tokenPath);
      await store.save({
        token: "tk",
        tokenSecret: "ts",
        consumerKey: "ck",
        obtainedAt: new Date().toISOString(),
        scope: "read,write",
        expiration: "never",
      });
      const { fetch, calls } = mockFetch(responses);
      const handle = await bootClient({
        config: makeConfig(),
        fetchImpl: fetch,
        projectConfig,
      });
      return { ...handle, calls };
    }

    it("list_lists uses projectConfig.boardId when boardId is omitted", async () => {
      const lists = [{ id: "L1", name: "Inbox" }];
      const { client, close, calls } = await seededAuthClient(
        withProjectConfig({ boardId: "BOARD-FROM-CONFIG" }),
        [{ body: JSON.stringify(lists) }],
      );
      try {
        const res = await client.callTool({ name: "list_lists", arguments: {} });
        expect(JSON.parse(textOf(res as never))).toEqual(lists);
        expect(calls[0]!.url).toContain("/boards/BOARD-FROM-CONFIG/lists");
      } finally {
        await close();
      }
    });

    it("list_lists prefers an explicit boardId over the project default", async () => {
      const lists = [{ id: "L1" }];
      const { client, close, calls } = await seededAuthClient(
        withProjectConfig({ boardId: "FROM-CONFIG" }),
        [{ body: JSON.stringify(lists) }],
      );
      try {
        await client.callTool({
          name: "list_lists",
          arguments: { boardId: "EXPLICIT-BOARD" },
        });
        expect(calls[0]!.url).toContain("/boards/EXPLICIT-BOARD/lists");
        expect(calls[0]!.url).not.toContain("FROM-CONFIG");
      } finally {
        await close();
      }
    });

    it("list_lists returns a structured error naming the config key when neither input nor config has boardId", async () => {
      const { client, close } = await seededAuthClient(EMPTY_PROJECT_CONFIG, []);
      try {
        const res = (await client.callTool({
          name: "list_lists",
          arguments: {},
        })) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
        expect(res.isError).toBe(true);
        expect(textOf(res as never)).toMatch(/Missing boardId/);
        expect(textOf(res as never)).toMatch(/trello.config.json/);
      } finally {
        await close();
      }
    });

    it("list_boards with projectConfig.orgId calls /organizations/<orgId>/boards", async () => {
      const boards = [{ id: "B1", name: "Demo", idOrganization: "ORG-1" }];
      const { client, close, calls } = await seededAuthClient(
        withProjectConfig({ orgId: "ORG-1" }),
        [{ body: JSON.stringify(boards) }],
      );
      try {
        const res = await client.callTool({ name: "list_boards", arguments: {} });
        expect(JSON.parse(textOf(res as never))).toEqual(boards);
        expect(calls[0]!.url).toContain("/organizations/ORG-1/boards");
      } finally {
        await close();
      }
    });

    it("project_config tool returns the loaded config + sourcePath", async () => {
      const { client, close } = await bootClient({
        config: makeConfig(),
        projectConfig: withProjectConfig({ orgId: "ORG-1", boardId: "BRD-1" }),
      });
      try {
        const res = await client.callTool({ name: "project_config", arguments: {} });
        const parsed = JSON.parse(textOf(res as never));
        expect(parsed.config).toEqual({ orgId: "ORG-1", boardId: "BRD-1" });
        expect(parsed.sourcePath).toBe("/fake/trello.config.json");
        expect(parsed.error).toBeNull();
      } finally {
        await close();
      }
    });
  });

  describe("status-aware tools", () => {
    const sampleBoardLists = [
      { id: "L-back", name: "Backlog", closed: false, idBoard: "B1", pos: 1 },
      { id: "L-prog", name: "In Progress", closed: false, idBoard: "B1", pos: 2 },
      { id: "L-qa", name: "QA", closed: false, idBoard: "B1", pos: 3 },
      { id: "L-done", name: "Done", closed: false, idBoard: "B1", pos: 4 },
      { id: "L-prod", name: "Production", closed: false, idBoard: "B1", pos: 5 },
    ];

    async function seededAuth() {
      const store = new TokenStore(tokenPath);
      await store.save({
        token: "tk",
        tokenSecret: "ts",
        consumerKey: "ck",
        obtainedAt: new Date().toISOString(),
        scope: "read,write",
        expiration: "never",
      });
    }

    it("cache_board_lists writes the status mapping to disk and returns unmapped statuses", async () => {
      await seededAuth();
      const { fetch, calls } = mockFetch([{ body: JSON.stringify(sampleBoardLists) }]);
      const cacheFile = join(dir, "test-cache.json");
      const { client, close } = await bootClient({
        config: makeConfig(),
        fetchImpl: fetch,
        projectConfig: withProjectConfig({ boardId: "B1" }),
        listCachePath: cacheFile,
      });
      try {
        const res = await client.callTool({ name: "cache_board_lists", arguments: {} });
        const parsed = JSON.parse(textOf(res as never));
        expect(parsed.statusMapping).toEqual({
          backlog: "L-back",
          in_progress: "L-prog",
          qa: "L-qa",
          done: "L-done",
          production_critical: "L-prod",
        });
        expect(parsed.unmapped).toEqual(["todo", "blocked", "review"]);
        expect(parsed.cachePath).toBe(cacheFile);
        expect(calls[0]!.url).toContain("/boards/B1/lists");

        const onDisk = JSON.parse(await readFile(cacheFile, "utf8"));
        expect(onDisk.boardId).toBe("B1");
        expect(onDisk.statusMapping.done).toBe("L-done");
      } finally {
        await close();
      }
    });

    it("move_card_by_status reads the cache and PUTs to /cards/<id> with the right idList", async () => {
      await seededAuth();
      const cacheFile = join(dir, "test-cache.json");
      // Pre-seed a cache so move_card_by_status doesn't need to fetch.
      await fsWriteFile(
        cacheFile,
        JSON.stringify({
          boardId: "B1",
          boardName: "Demo",
          fetchedAt: new Date().toISOString(),
          lists: sampleBoardLists,
          statusMapping: { qa: "L-qa", done: "L-done" },
        }),
      );

      const updatedCard = { id: "C1", name: "Test", idList: "L-qa" };
      const { fetch, calls } = mockFetch([{ body: JSON.stringify(updatedCard) }]);
      const { client, close } = await bootClient({
        config: makeConfig(),
        fetchImpl: fetch,
        projectConfig: withProjectConfig({ boardId: "B1" }),
        listCachePath: cacheFile,
      });
      try {
        const res = await client.callTool({
          name: "move_card_by_status",
          arguments: { cardId: "C1", status: "qa" },
        });
        const parsed = JSON.parse(textOf(res as never));
        expect(parsed.movedTo).toEqual({
          status: "qa",
          listId: "L-qa",
          listName: "QA",
        });
        expect(parsed.cacheVerified).toBe(true);
        expect(parsed.warning).toBeUndefined();
        expect(calls).toHaveLength(1);
        const url = new URL(calls[0]!.url);
        expect(calls[0]!.method).toBe("PUT");
        expect(url.pathname).toBe("/1/cards/C1");
        expect(url.searchParams.get("idList")).toBe("L-qa");
      } finally {
        await close();
      }
    });

    it("move_card_by_status flags cacheVerified=null and emits a warning when no project boardId is set", async () => {
      await seededAuth();
      const cacheFile = join(dir, "test-cache.json");
      await fsWriteFile(
        cacheFile,
        JSON.stringify({
          boardId: "B-FROM-CACHE",
          boardName: "Whatever",
          fetchedAt: new Date().toISOString(),
          lists: sampleBoardLists,
          statusMapping: { qa: "L-qa" },
        }),
      );
      const updatedCard = { id: "C1", idList: "L-qa" };
      const { fetch } = mockFetch([{ body: JSON.stringify(updatedCard) }]);
      // No project config boardId — cache is consulted as the source of truth,
      // but the response must say so.
      const { client, close } = await bootClient({
        config: makeConfig(),
        fetchImpl: fetch,
        // projectConfig defaults to EMPTY_PROJECT_CONFIG via bootClient.
        listCachePath: cacheFile,
      });
      try {
        const res = await client.callTool({
          name: "move_card_by_status",
          arguments: { cardId: "C1", status: "qa" },
        });
        const parsed = JSON.parse(textOf(res as never));
        expect(parsed.movedTo.listId).toBe("L-qa");
        expect(parsed.cacheVerified).toBeNull();
        expect(parsed.cacheBoardId).toBe("B-FROM-CACHE");
        expect(parsed.warning).toMatch(/without verifying against project config/);
      } finally {
        await close();
      }
    });

    it("move_card_by_status auto-warms the cache when missing (no cache file → fetch lists then PUT card)", async () => {
      await seededAuth();
      const cacheFile = join(dir, "test-cache.json"); // does NOT exist yet
      const updatedCard = { id: "C1", name: "Test", idList: "L-prod" };
      const { fetch, calls } = mockFetch([
        { body: JSON.stringify(sampleBoardLists) }, // GET /boards/B1/lists
        { body: JSON.stringify(updatedCard) },      // PUT /cards/C1
      ]);
      const { client, close } = await bootClient({
        config: makeConfig(),
        fetchImpl: fetch,
        projectConfig: withProjectConfig({ boardId: "B1" }),
        listCachePath: cacheFile,
      });
      try {
        const res = await client.callTool({
          name: "move_card_by_status",
          arguments: { cardId: "C1", status: "production_critical" },
        });
        const parsed = JSON.parse(textOf(res as never));
        expect(parsed.movedTo.listId).toBe("L-prod");
        expect(parsed.movedTo.listName).toBe("Production");
        expect(calls).toHaveLength(2);
        expect(calls[0]!.url).toContain("/boards/B1/lists");
        expect(new URL(calls[1]!.url).searchParams.get("idList")).toBe("L-prod");

        // Cache file should now exist on disk
        const onDisk = JSON.parse(await readFile(cacheFile, "utf8"));
        expect(onDisk.statusMapping.production_critical).toBe("L-prod");
      } finally {
        await close();
      }
    });

    it("move_card_by_status returns a structured error when the status is unmapped on the board", async () => {
      await seededAuth();
      const cacheFile = join(dir, "test-cache.json");
      // Cache with only Backlog/Done lists — qa is unmapped.
      await fsWriteFile(
        cacheFile,
        JSON.stringify({
          boardId: "B1",
          boardName: "Demo",
          fetchedAt: new Date().toISOString(),
          lists: [
            { id: "L1", name: "Backlog", closed: false, pos: 1 },
            { id: "L2", name: "Done", closed: false, pos: 2 },
          ],
          statusMapping: { backlog: "L1", done: "L2" },
        }),
      );
      const { fetch } = mockFetch([]);
      const { client, close } = await bootClient({
        config: makeConfig(),
        fetchImpl: fetch,
        projectConfig: withProjectConfig({ boardId: "B1" }),
        listCachePath: cacheFile,
      });
      try {
        const res = (await client.callTool({
          name: "move_card_by_status",
          arguments: { cardId: "C1", status: "qa" },
        })) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
        expect(res.isError).toBe(true);
        expect(textOf(res as never)).toMatch(/Status "qa" has no matching list/);
        expect(textOf(res as never)).toMatch(/QA/);
      } finally {
        await close();
      }
    });

    it("list_lists writes the mapping cache as a side effect (cache: true is the default)", async () => {
      await seededAuth();
      const cacheFile = join(dir, "test-cache.json");
      const { fetch } = mockFetch([{ body: JSON.stringify(sampleBoardLists) }]);
      const { client, close } = await bootClient({
        config: makeConfig(),
        fetchImpl: fetch,
        projectConfig: withProjectConfig({ boardId: "B1" }),
        listCachePath: cacheFile,
      });
      try {
        await client.callTool({ name: "list_lists", arguments: {} });
        const onDisk = JSON.parse(await readFile(cacheFile, "utf8"));
        expect(onDisk.boardId).toBe("B1");
        expect(onDisk.statusMapping.done).toBe("L-done");
        expect(onDisk.lists.map((l: { id: string }) => l.id)).toEqual([
          "L-back", "L-prog", "L-qa", "L-done", "L-prod",
        ]);
      } finally {
        await close();
      }
    });

    it("list_lists with cache:false does NOT write the cache file", async () => {
      await seededAuth();
      const cacheFile = join(dir, "no-cache.json");
      const { fetch } = mockFetch([{ body: JSON.stringify(sampleBoardLists) }]);
      const { client, close } = await bootClient({
        config: makeConfig(),
        fetchImpl: fetch,
        projectConfig: withProjectConfig({ boardId: "B1" }),
        listCachePath: cacheFile,
      });
      try {
        await client.callTool({
          name: "list_lists",
          arguments: { cache: false },
        });
        await expect(readFile(cacheFile, "utf8")).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        await close();
      }
    });
  });

  it("auth_status reports a config error when no env is set", async () => {
    const { client, close } = await bootClient({
      config: null,
      configError: "Missing required environment variable: TRELLO_CONSUMER_KEY",
    });
    try {
      const res = await client.callTool({ name: "auth_status", arguments: {} });
      const parsed = JSON.parse(textOf(res as never));
      expect(parsed.configured).toBe(false);
      expect(parsed.configError).toMatch(/TRELLO_CONSUMER_KEY/);
    } finally {
      await close();
    }
  });
});

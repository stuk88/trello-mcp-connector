# trello-mcp-connector

A Model Context Protocol server that exposes Trello (boards, lists, cards, and
webhooks) to any MCP client — including Claude Code. Authentication is OAuth
1.0a, so the connector never sees a long-lived personal API token and the user
can revoke access at any time from the Trello account settings.

## Features

- 16 typed MCP tools across auth, boards, lists, cards, and webhooks.
- OAuth 1.0a login from inside the MCP session (`auth_login` opens a local
  callback server, you authorize in your browser, the token is persisted with
  mode `0600` to `~/.trello-connector/tokens.json`).
- All Trello requests are signed with HMAC-SHA1 per RFC 5849 — no third-party
  signing library; the implementation is in
  [`src/trello/signing.ts`](src/trello/signing.ts).
- Standalone webhook receiver binary (`trello-webhook-server`) that verifies
  Trello's `x-trello-webhook` HMAC header and appends events to a JSONL log.

## Requirements

- Node.js ≥ 20 (uses the built-in `fetch`).
- (Optional) a Trello "API Key" + "OAuth Secret" pair from
  [https://trello.com/app-key](https://trello.com/app-key). A shared app pair is
  bundled in [`src/config.ts`](src/config.ts); set `TRELLO_CONSUMER_KEY` /
  `TRELLO_CONSUMER_SECRET` only to point the connector at a different app. These
  identify the application; per-user tokens are obtained at runtime via OAuth.

## Setup

```sh
npm install
npm run build
```

### Allowed Origins (only if you bring your own app key)

The bundled app already has the local OAuth callback origin
(`http://127.0.0.1:51823`) registered, so the default setup needs nothing here.
If you override `TRELLO_CONSUMER_KEY` / `TRELLO_CONSUMER_SECRET` with your own
app, register the callback origin on that app — Trello no longer accepts the
`*` wildcard and returns `Invalid return_url` otherwise:

1. Open [https://trello.com/app-key](https://trello.com/app-key).
2. Under **Allowed Origins**, add `http://127.0.0.1:51823` and submit.
3. Remove the `*` entry if present.

If you also change `TRELLO_OAUTH_CALLBACK_PORT` from its default of `51823`, add
the corresponding origin instead.

## Running the MCP server

The server speaks JSON-RPC on stdio, which is what every MCP client expects.

```sh
node dist/index.js
```

### Wiring it into Claude Code

Add an entry to your MCP config (`~/.claude.json` or the project-local
equivalent):

```json
{
  "mcpServers": {
    "trello": {
      "command": "node",
      "args": ["/absolute/path/to/trello-connector-claude-code/dist/index.js"]
    }
  }
}
```

Then, from a Claude Code session, the first thing to do is call `auth_login`.
The tool prints an authorize URL on stderr and waits for you to approve in
your browser. After approval, the resulting OAuth token is saved to
`~/.trello-connector/tokens.json` (override with `TRELLO_CONNECTOR_HOME`).

## Project config

Drop a `trello.config.json` at the root of any project where you want a
default Trello workspace/board/list. All fields are optional:

```json
{
  "orgId": "62fd06b5557b5f7aa17491e3",
  "boardId": "69393e2fd803bc784c25e712",
  "listId": "65a1e7c8..."
}
```

When set, tools fall back to these defaults:

- `list_boards` with no `orgId` → boards in the configured workspace.
- `get_board` / `list_lists` / `create_list` with no `boardId` → the
  configured board.
- `create_card` with no `listId` → the configured list.

Explicit inputs always win. Call `project_config` from inside Claude to see
what's loaded and from where.

The file is loaded from the MCP server's `cwd` (Claude Code launches it at
the project root). Override the lookup with `TRELLO_PROJECT_CONFIG=path` if
you need a custom location. The ids are public (they appear in Trello URLs),
so commit `trello.config.json` if you want team-wide defaults, or gitignore
it if it's personal.

## Tools

| Category | Tool | Description |
| -------- | ---- | ----------- |
| auth     | `auth_status` | Report config + token state. |
| auth     | `auth_login` | Run the OAuth 1.0a dance; persist the token. |
| auth     | `auth_logout` | Delete the persisted token. |
| project  | `project_config` | Show the loaded project config + source path. |
| boards   | `list_boards` | List boards (filtered by `orgId` if set). |
| boards   | `get_board` | Fetch a board with optional `lists` / `cards`. |
| lists    | `list_lists` | Lists on a board. Also writes the status→list mapping cache. |
| lists    | `create_list` | Create a list. |
| lists    | `update_list` | Rename / archive / move a list. |
| cards    | `list_cards` | Cards on a list. |
| cards    | `get_card` | Full card with members, labels, checklists. |
| cards    | `create_card` | Create a card on a list. |
| cards    | `update_card` | Edit name, desc, due, list, members, labels. |
| cards    | `delete_card` | Delete a card permanently. |
| attachments | `list_attachments` | List a card's attachments. |
| attachments | `attach_url` | Attach a URL (link) to a card. |
| attachments | `attach_file` | Upload a file to a card via `filePath` or `base64`. |
| attachments | `delete_attachment` | Remove an attachment from a card. |
| checklists | `list_checklists` | A card's checklists with their items. |
| checklists | `create_checklist` | Add a checklist to a card. |
| checklists | `delete_checklist` | Remove a checklist from a card. |
| checklists | `add_checkitem` | Add an item to a checklist. |
| checklists | `update_checkitem` | Rename, (un)check, or reposition an item. |
| checklists | `delete_checkitem` | Remove an item from a checklist. |
| comments | `list_comments` | A card's comments. |
| comments | `add_comment` | Comment on a card. |
| comments | `update_comment` | Edit a comment's text. |
| comments | `delete_comment` | Delete a comment. |
| status   | `cache_board_lists` | Refresh the per-board status→list mapping cache. |
| status   | `move_card_by_status` | Move a card by task status (e.g. `done`, `qa`, `production_critical`). |
| webhooks | `list_webhooks` | List webhooks owned by your token. |
| webhooks | `create_webhook` | Register a webhook (`idModel` + `callbackURL`). |
| webhooks | `delete_webhook` | Unregister a webhook. |

## Status-driven workflow

Tasks have statuses, but every Trello board names its lists differently
(`Done`, `Completed`, `Shipped`, `Done ✅`). The connector maps a stable
8-status taxonomy to whichever lists exist on your board.

**Statuses:** `backlog`, `todo`, `in_progress`, `blocked`, `review`, `qa`,
`done`, `production_critical`.

**How the mapping is built:** Each status has an ordered list of substring
patterns (case-insensitive). The first open list whose name contains a
pattern wins. For example, `done` matches `Done|Completed|Shipped|Closed`,
and `production_critical` matches `Production|Hotfix|Critical|Incident|Urgent`.

**Where it's stored:** `<cwd>/.trello-list-mapping.json` — gitignored by
default. `list_lists` writes it as a side effect (`cache: false` to skip).
`cache_board_lists` writes it on demand and reports unmapped statuses.

**Moving a card by status:**

```jsonc
// MCP tool call
{
  "name": "move_card_by_status",
  "arguments": { "cardId": "abc123", "status": "qa" }
}
```

If the cache is missing or stale, the tool auto-warms it. If your board has
no list matching the requested status, the tool returns a structured error
listing the common names that *would* match (so you can rename a list and
try again).

**Slash command:** install the user-scope skill at
`~/.claude/skills/trello-update/SKILL.md` (shipped in this repo). Then in
any Claude Code session: *"Move card X to QA"* → `/trello-update` →
done.

## Webhooks

Trello requires a publicly reachable HTTPS `callbackURL`. The MCP server only
registers webhooks against Trello (using a URL you provide); the actual event
receiver is a separate process so the MCP server can stay stdio-only.

Run the receiver locally:

```sh
TRELLO_CONSUMER_KEY=... TRELLO_CONSUMER_SECRET=... \
  node dist/webhooks/receiver.js \
  --port 4567 \
  --callback-url https://your-tunnel.example.com/
```

Tunnel `:4567` with [ngrok](https://ngrok.com) or
[cloudflared](https://github.com/cloudflare/cloudflared), then pass the public
URL to `create_webhook`. The receiver:

- responds `200` to Trello's verification `HEAD` request,
- verifies the `x-trello-webhook` signature using the consumer secret (per
  Trello's docs: `base64(HMAC-SHA1(body + callbackURL, secret))`),
- appends each event as one JSON line to
  `~/.trello-connector/webhook-events.log` (override with `TRELLO_WEBHOOK_LOG`).

Requests with a missing or invalid signature are rejected with HTTP 401 and
**not** logged.

## Layout

```
src/
  index.ts            entry: stdio MCP server
  server.ts           builds the McpServer
  config.ts           env / paths
  trello/
    client.ts         signed REST wrapper
    oauth.ts          request-token + access-token flow
    signing.ts        RFC 5849 HMAC-SHA1 signing
    types.ts          Board, List, Card, Webhook, Member, PersistedAuth
  auth/
    store.ts          ~/.trello-connector/tokens.json (mode 0600)
    callback.ts       one-shot OAuth callback HTTP server
  tools/              one file per resource; thin Zod -> client adapters
  webhooks/
    receiver.ts       standalone HTTP receiver bin
tests/                vitest; 85 tests across 11 files
design-log/
  001-trello-mcp-connector.md
```

## Development

```sh
npm run typecheck   # tsc --noEmit
npm test            # vitest run (85 tests)
npm run dev         # tsx src/index.ts — run from source
```

Tests mock `fetch` for unit/integration tests of the client and OAuth flow,
and use the MCP SDK's in-memory transport for end-to-end server tests. The
signing test validates against the RFC 5849 §3.4 worked example.

## Security notes

- Token store is created with `0600` permissions and the parent dir with
  `0700`. The OAuth callback server binds only to `127.0.0.1`.
- The webhook receiver fails closed on signature mismatch; requests with a
  missing `x-trello-webhook` header are accepted only when the consumer secret
  is unavailable (config error path) — in that case verification is skipped
  and the entry is logged with `verified: null` so you can audit later.
- No credentials are ever written to stdout. The MCP stdio transport requires
  a clean stdout — all diagnostics go to stderr.

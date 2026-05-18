---
status: in-progress
created: 2026-05-14
owner: stas
---

# Trello MCP Connector

## Background

Trello exposes a REST API for boards, lists, cards, members, and webhooks. The
official auth model for third-party apps is OAuth 1.0a; an API-key + token
pair is also accepted but is single-user and ties the connector to one Trello
identity. This project ships an MCP server that lets Claude Code (or any MCP
client) drive a user's Trello workspace.

## Problem

Claude Code has no first-class Trello tooling. Users who manage work on Trello
have to copy/paste card content into chat or write ad-hoc scripts. We want a
local MCP server that exposes Trello as a small set of typed tools and handles
auth cleanly so the model can read boards, manage lists/cards, and register
webhooks without leaking credentials into the conversation.

## Questions & Answers

**Q: API key + token vs OAuth 1.0a?**
A: OAuth 1.0a. Token is per-user and revocable from Trello's settings page,
which is safer than committing/exporting a long-lived personal token. The
extra complexity is contained in `src/auth/`.

**Q: How are webhooks delivered to a local MCP process?**
A: They are not — Trello requires a publicly reachable HTTPS callback URL.
We split this into two responsibilities:
- The MCP server exposes tools to **register / list / delete** webhooks against
  Trello (using a `callbackURL` the caller supplies).
- A separate `trello-webhook-server` CLI command starts a local HTTP receiver
  that logs events to disk. Users tunnel it (ngrok / cloudflared) when they
  want end-to-end delivery. This keeps the MCP server itself stdio-only.

**Q: Where do OAuth tokens live?**
A: `~/.trello-connector/tokens.json` (mode 0600). Path overridable via
`TRELLO_CONNECTOR_HOME`.

**Q: How does the user complete the OAuth flow?**
A: An `auth_login` tool launches a one-shot local HTTP callback server on a
free port, prints the authorize URL, and waits for the verifier. The token +
secret are then written to the token store.

## Design

### Components

```
┌──────────────────────┐         ┌────────────────────────┐
│  Claude Code (MCP)   │ stdio   │  trello-mcp-server     │
│  client              │◀───────▶│  (this project)        │
└──────────────────────┘         └─────────┬──────────────┘
                                           │ HTTPS
                                           ▼
                                  ┌────────────────────┐
                                  │  api.trello.com    │
                                  └────────────────────┘

Optional, run separately:
┌────────────────────────────┐         ┌────────────────────┐
│  trello-webhook-server     │◀────────│  Trello webhooks   │
│  (local HTTP, log events)  │  HTTPS  │                    │
└────────────────────────────┘  via    └────────────────────┘
                              ngrok/etc
```

### Modules (SOLID — one responsibility each)

| File                          | Responsibility                                    |
| ----------------------------- | ------------------------------------------------- |
| `src/index.ts`                | Process entry. Starts stdio MCP transport.        |
| `src/server.ts`               | Builds `McpServer`, registers tools.              |
| `src/config.ts`               | Env loading, token-store path resolution.         |
| `src/trello/client.ts`        | `TrelloClient` — typed wrapper over Trello REST.  |
| `src/trello/oauth.ts`         | OAuth 1.0a: request token, authorize URL, access. |
| `src/trello/signing.ts`       | OAuth 1.0a HMAC-SHA1 signature base + signing.    |
| `src/trello/types.ts`         | Trello entity types (Board, List, Card, Webhook). |
| `src/auth/store.ts`           | Read/write `tokens.json` (mode 0600).             |
| `src/auth/callback.ts`        | One-shot local HTTP server for OAuth callback.    |
| `src/tools/register.ts`       | Wires all tool modules into the `McpServer`.      |
| `src/tools/{auth,boards,lists,cards,webhooks}.ts` | Tool definitions.     |
| `src/webhooks/receiver.ts`    | Standalone HTTP receiver (separate bin).          |

### Tools exposed via MCP

| Tool                | Purpose                                             |
| ------------------- | --------------------------------------------------- |
| `auth_status`       | Report whether a user token exists and its scopes.  |
| `auth_login`        | Run OAuth 1.0a flow; persist token.                 |
| `auth_logout`       | Delete persisted token.                             |
| `list_boards`       | List boards visible to the authed user.             |
| `get_board`         | Fetch one board with lists+cards optionally.        |
| `list_lists`        | Lists on a board.                                   |
| `create_list`       | Create a list on a board.                           |
| `update_list`       | Rename / archive / move a list.                     |
| `list_cards`        | Cards on a list.                                    |
| `get_card`          | Fetch a card with members, labels, checklists.      |
| `create_card`       | Create a card on a list.                            |
| `update_card`       | Edit name, desc, due, members, labels, list.        |
| `delete_card`       | Delete a card.                                      |
| `list_webhooks`     | List webhooks owned by the user token.              |
| `create_webhook`    | Register webhook on a model with a callbackURL.     |
| `delete_webhook`    | Unregister a webhook by id.                         |

### OAuth 1.0a sequence

1. POST `https://trello.com/1/OAuthGetRequestToken` with `oauth_callback` = local server URL → receive `oauth_token`, `oauth_token_secret`.
2. Open browser at `https://trello.com/1/OAuthAuthorizeToken?oauth_token=…&name=…&scope=read,write,account&expiration=never`.
3. User authorizes; Trello redirects to local callback with `oauth_token` + `oauth_verifier`.
4. POST `https://trello.com/1/OAuthGetAccessToken` with the request token + verifier → receive permanent `oauth_token` + `oauth_token_secret`.
5. Persist to token store.

### Request signing

Every subsequent call to `api.trello.com/1/*` is signed with HMAC-SHA1
using `consumer_secret&token_secret` as the signing key. All non-Authorization
parameters (query + form body) participate in the signature base string per
RFC 5849. Helper lives in `src/trello/signing.ts`; reused by both
`oauth.ts` (during the dance) and `client.ts` (every API call).

## Implementation Plan

1. Project scaffold (package.json, tsconfig, .gitignore, .env.example).
2. Core types + OAuth signing helper + unit tests for signature base string.
3. `TrelloClient` with `request()` central method; per-resource methods.
4. OAuth flow + token store + callback server.
5. MCP server + tool registration.
6. Standalone webhook receiver bin.
7. Integration tests: mock `fetch` for client, in-process callback server
   test for OAuth, end-to-end MCP tool roundtrip via the SDK's in-memory
   client transport.
8. README with setup/usage.

## Trade-offs

- **OAuth 1.0a vs key+token**: chose OAuth for revocability and multi-account
  capability. Cost: ~150 LOC of signing + callback machinery.
- **Webhook receiver split out**: keeps the MCP server stdio-pure. Cost: users
  needing end-to-end webhooks must run a second process and a tunnel.
- **No SDK dependency for OAuth signing**: use a tiny in-tree signer rather
  than `oauth-1.0a` package. Cost: ~60 LOC and tests. Benefit: fewer deps,
  one place to audit signing logic.

## Verification Criteria

- Unit: signature base string matches RFC 5849 worked examples.
- Unit: token store round-trips with mode 0600 enforced.
- Integration: with `fetch` mocked, every tool produces a correctly-signed
  Trello request URL+headers for representative inputs.
- Integration: in-memory MCP client lists tools and invokes
  `list_boards` / `create_card` / `list_webhooks` end-to-end.
- Manual (documented in README): real OAuth dance against trello.com from a
  developer machine.

---

## Implementation Results

### Deviation: fixed OAuth callback port

The Design section assumed the OAuth callback could bind to a random local
port (`server.listen(0, …)`). First real `auth_login` against trello.com
failed: Trello returned `Invalid return_url. Wildcard ("*") allowed origins
are no longer supported. Contact the developer.` The `*` entry on the
app-key page is no longer enforced as a permissive wildcard — Trello now
requires the redirect origin to be an exact match against the registered
Allowed Origins list.

**Fix shipped:**

- New `Config.oauthCallbackPort` (env: `TRELLO_OAUTH_CALLBACK_PORT`, default
  `51823`). Wired through `auth_login` -> `startCallbackServer({ port })`.
- README gained a required "Allowed Origins" setup step:
  add `http://127.0.0.1:51823` (and remove the `*`).
- `.env.example` + `.env` updated; `tests/server.test.ts` fixture extended.
- All 41 tests still passed at the time of this fix (test count has since
  grown — see latest README for the current number).

**Lesson (captured here so future sessions don't repeat it):** "Deprecated"
on Trello's app-key page is not "still functional today." The wildcard `*`
in Allowed Origins has been enforced. Any local OAuth callback must use a
fixed port that's registered as an exact origin.

---
status: in-progress
created: 2026-05-15
owner: stas
---

# Project-level config for the Trello connector

## Background

The MCP connector is a single Node process registered once with Claude Code
(user-scope) and re-used across every project the user opens. Every Trello
write tool currently requires an explicit `boardId` (or `listId`), so an
operator who lives mostly in one board has to repeat that id on every call.

**Today:**
- `src/server.ts` builds the server with only env-derived `Config`.
- Tools like `get_board`, `list_lists`, `create_list`, `create_card`,
  `list_boards` take their target ids as required inputs.
- There's no per-project surface area on `ToolContext`.

## Problem

We want a "current project = this Trello board" binding so that:
- Tool calls in project A default to board A; project B → board B.
- The binding is a normal file in the repo (commit-friendly when teams want
  shared defaults; gitignorable when personal).
- Explicit inputs to the tool still win — config is a default, not a prison.

## Questions & Answers

**Q: Where does the file live?**
A: `<cwd>/trello.config.json`. Claude Code launches the MCP server with the
project directory as its `cwd`, so this naturally picks up per-project.
Overridable via `TRELLO_PROJECT_CONFIG` env var for testing / custom setups.

**Q: Hidden file or visible?**
A: Visible (`trello.config.json`). Mirrors `tsconfig.json` / `next.config.json`
conventions, easier to spot in editors, less mystery.

**Q: What fields?**
A: All optional:
- `orgId` — default Trello organization id (workspace).
- `boardId` — default board id (or shortLink).
- `listId` — default list id, used by `create_card` when `listId` is omitted.

**Q: Commit or gitignore?**
A: Up to the team. Document in README that the ids are public (they appear
in Trello URLs) so committing for shared defaults is safe.

**Q: What if the file is malformed?**
A: Log a warning to stderr and treat as missing. Never crash the MCP server
on bad project config — the connector should still work for explicitly-passed
ids.

## Design

### Loader (`src/project-config.ts`)

```ts
const ProjectConfigSchema = z.object({
  orgId: z.string().min(1).optional(),
  boardId: z.string().min(1).optional(),
  listId: z.string().min(1).optional(),
});

export interface LoadedProjectConfig {
  config: ProjectConfig | null;
  sourcePath: string | null;  // null when nothing was loaded
  error: string | null;        // populated when a file existed but parse failed
}

export function loadProjectConfig(opts: {
  cwd: string;
  envPath?: string;     // TRELLO_PROJECT_CONFIG
}): LoadedProjectConfig
```

Behaviour matrix:

| Case                        | config | sourcePath | error  |
| --------------------------- | ------ | ---------- | ------ |
| No file at expected path    | null   | null       | null   |
| File exists, valid          | parsed | absolute   | null   |
| File exists, malformed JSON | null   | absolute   | "..."  |
| File exists, schema fail    | null   | absolute   | "..."  |

### Wiring

- `Config` (in `src/config.ts`) gains `projectConfigPath` (the cwd-derived
  default, used by the loader) — but the loaded `LoadedProjectConfig` itself
  lives on `ToolContext`, not on `Config`, because it can change at runtime
  if we ever add a "reload" tool. (We don't, today.)
- `makeToolContext` runs `loadProjectConfig` once at server build time and
  caches the result on `ctx.projectConfig`.

### Tool changes (all additive)

| Tool             | Change                                                |
| ---------------- | ----------------------------------------------------- |
| `list_boards`    | `orgId` becomes optional input; falls back to `ctx.projectConfig?.config?.orgId`. When set, uses `/organizations/<id>/boards`; otherwise `/members/me/boards`. |
| `get_board`      | `boardId` becomes optional; falls back to project config. |
| `list_lists`     | `boardId` becomes optional; same fallback.            |
| `create_list`    | `boardId` becomes optional; same fallback.            |
| `create_card`    | `listId` becomes optional; falls back to `projectConfig.listId`. |
| `project_config` | New tool. Returns `{ sourcePath, config, error }`.    |

Tools where a required id can't be resolved (no input, no project config)
return a clear `isError: true` result naming both the input and the config
field the user could set.

### TrelloClient additions

`listOrgBoards(orgId)` → `GET /organizations/<orgId>/boards`. Same field
filter as `listBoards`.

## Implementation Plan

1. `src/project-config.ts` + schema + tests (happy / malformed / missing).
2. Wire into `ToolContext`; expose `projectConfig` to all tool modules.
3. Loosen `boardId` / `listId` schemas, add resolver helper that returns
   the resolved id or a structured error message.
4. `TrelloClient.listOrgBoards`; update `list_boards` tool to dispatch.
5. New `project_config` tool + register it.
6. Add a `trello.config.json` to *this* repo (since the project is itself a
   real Trello-connected project — `boardId` = "Tech Developement" board
   we just listed).
7. Run all tests + smoke test `list_boards` and `list_lists` with no
   explicit id.

## Trade-offs

- **Single fixed filename**: simpler than supporting multiple (`.trello.json`,
  `trello.json`, `.trellorc`). Can grow later if needed.
- **Eager load at server start**: file is small and static within a session.
  Adding a `reload` path would be premature.
- **No deep upward search**: only `<cwd>/trello.config.json`. Claude Code
  always launches the server at the project root, so deep search would
  just add ambiguity. `TRELLO_PROJECT_CONFIG` covers exotic setups.

## Verification Criteria

- Unit: loader returns each of the 4 behavior-matrix cases correctly.
- Unit: tool input resolver returns the explicit input when present, the
  project default when input omitted, and a clear error when neither exists.
- Integration: `list_boards` with no args after `trello.config.json` has an
  `orgId` issues a `GET /organizations/<orgId>/boards`.
- Integration: `list_lists` with no `boardId` after `trello.config.json` has
  a `boardId` issues `GET /boards/<boardId>/lists`.
- Manual: against real Trello, with this repo's `trello.config.json` set to
  the Tech Development board, `list_lists` with no args returns its lists.

---
status: in-progress
created: 2026-05-15
owner: stas
---

# Status-aware card moves + `/trello-update` skill

## Background

The connector can already create, read, and update cards. The current
`update_card` accepts an `idList` to relocate a card, but the caller has to
know the list id by hand. Real-world workflows are *status-driven*: "this is
done — move it to QA", "this is a prod issue — move it to the critical
list". Trello list names are board-specific (`Done`, `Completed`, `Shipped`,
`Done ✅`, all mean the same thing in different boards), so the connector
needs a layer that maps a project-stable *status* to a board-specific
*list id*.

**Today:**
- `src/tools/lists.ts` exposes `list_lists` that returns `List[]` directly
  from Trello with no persistence.
- `src/tools/cards.ts` exposes `update_card` taking a raw `idList`.
- `trello.config.json` holds optional `orgId`, `boardId`, `listId` — but
  only one `listId`, not a status→list map.
- No skill exists yet.

## Problem

We want:

1. A typed task-status taxonomy that's stable across boards.
2. A way to learn the status→list mapping for the *current* board by
   matching list names — captured automatically when lists are fetched,
   persisted so the model doesn't re-derive on every call.
3. A tool to move a card to the list a status maps to.
4. A slash-command skill that drives this from a Claude Code session:
   `/trello-update`.

## Questions & Answers

**Q: What statuses?**
A: Eight, covering the lifecycle of an engineering task:

| Status                | Meaning                                         |
| --------------------- | ----------------------------------------------- |
| `backlog`             | Collected idea, not yet committed.              |
| `todo`                | Committed, ready to be pulled.                  |
| `in_progress`         | Actively being worked on.                       |
| `blocked`             | Waiting on an external dependency.              |
| `review`              | Code complete, awaiting review (PR open).       |
| `qa`                  | In QA / staging testing.                        |
| `done`                | Shipped to production / completed.              |
| `production_critical` | Live production incident / urgent fix needed.   |

These are the user-supplied three (`done`, `backlog`, `production_critical`)
plus the standard intermediate states most engineering teams track.

**Q: How does a status match a Trello list?**
A: Case-insensitive substring match against the list name, against an
ordered list of patterns per status. First pattern that matches any open
list wins. Patterns are tuned to common Trello list-naming conventions:

```ts
backlog:             ["backlog", "inbox", "ideas", "future"]
todo:                ["to do", "todo", "next", "ready", "up next"]
in_progress:         ["in progress", "doing", "wip", "working"]
blocked:             ["blocked", "on hold", "waiting", "stuck"]
review:              ["in review", "review", "pr ", "code review"]
qa:                  ["qa", "staging", "testing", "test"]
done:                ["done", "completed", "shipped", "closed"]
production_critical: ["production", "hotfix", "critical", "incident", "urgent"]
```

A status with no matching list is reported as *unmapped*; the tool/skill
surfaces this so the user can add the missing list (or pick another status).

**Q: Where is the cache stored?**
A: `<cwd>/.trello-list-mapping.json`, alongside `trello.config.json`.

Shape:
```json
{
  "boardId": "69393e2fd803bc784c25e712",
  "boardName": "Tech Developement",
  "fetchedAt": "2026-05-15T...",
  "lists": [
    { "id": "L1", "name": "Backlog", "closed": false, "pos": 1 }
  ],
  "statusMapping": {
    "backlog": "L1",
    "in_progress": "L2",
    "done": "L3"
  }
}
```

Gitignored by default — it's per-board and trivially re-derivable. Commit
if your team wants a frozen shared mapping (e.g. when list names get
renamed and you want everyone to wait until the cache is re-derived).

**Q: When does the cache update?**
A:
- `list_lists` writes the cache as a side effect (per the requirement
  "save available lists in the project on lists fetch").
- `cache_board_lists` writes it on demand and returns the mapping.
- `move_card_by_status` reads it. If absent, it auto-runs the fetch.

**Q: What does `/trello-update` actually do?**
A: It's a slash-command skill that:
1. Identifies the card (by id, shortLink, or — if Claude is told to search
   — by name via `get_card`).
2. Identifies the new status (asks if missing).
3. Calls `move_card_by_status` (which auto-warms the cache if needed).
4. Reports the new list + remaining unmapped statuses.

## Design

### New module `src/status-mapping.ts`

```ts
export type TaskStatus =
  | "backlog" | "todo" | "in_progress" | "blocked"
  | "review" | "qa" | "done" | "production_critical";

export const TASK_STATUSES: readonly TaskStatus[];

/** Ordered preference patterns per status (case-insensitive substring). */
export const STATUS_PATTERNS: Record<TaskStatus, readonly string[]>;

export function mapListsToStatuses(lists: Array<{ id: string; name: string; closed: boolean }>): {
  mapping: Partial<Record<TaskStatus, string>>;  // status → listId
  unmapped: TaskStatus[];                          // statuses with no list match
  ambiguous: Array<{ status: TaskStatus; chose: string; alternatives: string[] }>;
}
```

### New module `src/list-cache.ts`

```ts
export const LIST_CACHE_FILENAME = ".trello-list-mapping.json";

export interface ListCache {
  boardId: string;
  boardName: string | null;
  fetchedAt: string;            // ISO 8601
  lists: Array<{ id: string; name: string; closed: boolean; pos: number }>;
  statusMapping: Partial<Record<TaskStatus, string>>;
}

export function cachePath(cwd: string, envPath?: string): string;
export function readListCache(path: string): ListCache | null;        // missing → null
export function writeListCache(path: string, cache: ListCache): void;
```

### New tools (`src/tools/status.ts`)

| Tool                    | Args                                | Effect |
| ----------------------- | ----------------------------------- | ------ |
| `cache_board_lists`     | `{ boardId? }`                      | Fetches lists for board (resolves from project config), maps to statuses, writes cache file, returns it. |
| `move_card_by_status`   | `{ cardId, status, refresh? }`      | Reads cache (or re-runs `cache_board_lists` if missing or `refresh: true`), looks up listId, calls `client.updateCard(cardId, { idList })`. Returns updated card + the status→list resolution. |

### Tool change

`list_lists` gains a side effect: after a successful fetch, it computes the
status mapping for that board and writes the cache file. The change is
opt-out via a new `cache: boolean = true` input — set `false` for read-only
inspection without persistence.

### Skill `~/.claude/skills/trello-update/SKILL.md`

User-scope (works in every project that has the trello MCP server
registered). Frontmatter `name: trello-update`, `description: ...`.
Instructions tell Claude to:
1. Resolve the card id (ask if missing).
2. Resolve the new status (ask if missing; offer the 8 valid ones).
3. Call `move_card_by_status`.
4. If `move_card_by_status` reports the status is unmapped, fall back to
   `list_lists` and ask the user to pick the target list explicitly.

## Implementation Plan

1. `src/status-mapping.ts` + tests (happy / no-match / multi-match / case
   insensitivity / ordering).
2. `src/list-cache.ts` + tests (round-trip / missing-file / malformed-file).
3. `src/tools/status.ts` with `cache_board_lists` and `move_card_by_status`.
4. Update `list_lists` to write cache (opt-out).
5. Register the new tools.
6. Update `tests/server.test.ts` tool-list assertion.
7. `~/.claude/skills/trello-update/SKILL.md`.
8. README + .gitignore entry for `.trello-list-mapping.json`.
9. Run full suite. Drive a manual smoke test against real Trello against
   the "Tech Developement" board if available.

## Trade-offs

- **One status → one list**: not a many-to-many map. A board with two
  "Done" lists (`Done — Q1`, `Done — Q2`) will pick whichever comes first
  in board order. Documented in the tool's response under `ambiguous`.
- **Fuzzy match by patterns, not a learned ML thing**: deterministic,
  inspectable, easy to override (the user can edit the cache file by hand
  to override an auto-mapping).
- **Cache lives next to `trello.config.json`**, not in `~/.trello-connector`.
  Each project has its own board context, so the cache is project-local.
- **Skill is user-scope, not plugin-scope**: simpler to ship; doesn't need
  a plugin manifest. Trade-off: if someone clones this repo and doesn't
  install the connector, the slash command they see in the repo's docs
  won't exist on their machine.

## Verification Criteria

- Unit: `mapListsToStatuses` returns the expected mapping for a
  representative `["Backlog", "In Progress", "QA", "Done", "Production"]`
  board, with the right `unmapped` set.
- Unit: list cache round-trips a `ListCache` and gracefully returns `null`
  on missing file, throws structured error on malformed JSON.
- Integration: `cache_board_lists` with a mocked Trello returns the
  mapping and writes the cache file. `move_card_by_status` reads the
  cache and calls `update_card` with the right `idList`. With no cache,
  the tool auto-warms it and still succeeds.
- Integration: `list_lists` writes the cache as a side effect; the
  cache contents match what `cache_board_lists` would produce.
- Manual: against real Trello, run `/trello-update` against a known card,
  move from "In Progress" → "QA". Verify in the Trello UI.

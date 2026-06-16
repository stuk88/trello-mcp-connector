---
status: in-progress
created: 2026-06-16
owner: stas
---

# Card Attachments, Checklists, and Comments

## Background

The connector (design log [001](001-trello-mcp-connector.md)) exposes boards, lists,
cards, and webhooks. Card tools today are text-only: `create_card` / `update_card`
cover `name`, `desc`, `due`, `idMembers`, `idLabels`, `pos`, plus `closed` / `idList`
on update (see `registerCardTools` in `src/tools/cards.ts`; `createCard` / `updateCard`
in `src/trello/client.ts`). There is **no**
way to attach a file or URL, manage checklists, or add comments to a card — even
though Trello's REST API supports all three. This is a connector gap, not a Trello
limitation.

## Problem

A user driving Trello through Claude Code cannot:

- Attach a screenshot, log file, or reference URL to a card.
- Create/track checklists and tick items off as work progresses.
- Leave or read comments on a card (the natural place for status notes / activity).

These are core Trello card operations. We want them exposed as typed MCP tools that
reuse the existing `TrelloClient` + OAuth 1.0a signing, following the established
per-domain tool-module pattern.

## Questions & Answers

**Q1: How does a *file* reach `attach_file` over MCP? `filePath`, base64, or both?**
A (owner-approved): **Both `filePath` and `base64`.** `attach_file` accepts exactly one
of them:
- `filePath` — resolved against `process.cwd()`, read with `node:fs/promises`; filename
  derived via `path.basename` unless `name` overrides it. Natural for the local stdio
  server (token store under `~/.trello-connector`, see 001) and Claude Code, which works
  with local files.
- `base64` — decoded to a `Buffer`; covers in-memory / non-filesystem callers. Because
  there is no path to derive a filename from, **`name` is required when `base64` is
  used.** (base64 inflates payloads ~33% in the model's token stream, so `filePath` is
  preferred for anything non-trivial — but both are supported.)

Handler validation (returns a structured `err`, not a throw): exactly one of
`filePath` / `base64` must be present; `base64` without `name` is rejected.

**Q2: Multipart uploads and OAuth 1.0a — does the file participate in the signature?**
A: **No.** RFC 5849 §3.4.1.3: entity-body parameters join the signature base string
*only* when `Content-Type: application/x-www-form-urlencoded`. For
`multipart/form-data` the body is excluded. So we put the metadata (`name`,
`mimeType`, `setCover`) in the **query string** (signed by the existing
`signRequest` path) and put only the **file** in the multipart body (unsigned). We
must NOT set `Content-Type` manually — `undici`'s `FormData` sets
`multipart/form-data; boundary=…` itself. This refines 001's blanket "query + form
body participate" note for the multipart case.

**Q3: How granular should the tool surface be?**
A (owner-approved): **Full 14 tools (4 + 6 + 4)** — comprehensive CRUD per the request
("add attachment, checklist, or comment endpoints"). This grows the surface 19 → 33.
The leaner "core" subset documented in Trade-offs was declined.

**Q4: Should `get_card` embed checklists/attachments/comments instead of separate list tools?**
A: Keep **separate `list_*` tools**, matching the existing granular style
(`list_cards`, `list_lists`). `get_card` currently passes `fields=all` which does not
expand nested checklists/attachments without extra params; bolting them on would
overload one tool. Separate tools are clearer for the model to target.

## Design

### New tool modules (one responsibility each, per 001's SOLID table)

| File                          | Responsibility                              |
| ----------------------------- | ------------------------------------------- |
| `src/tools/attachments.ts`    | `registerAttachmentTools` — attachment CRUD |
| `src/tools/checklists.ts`     | `registerChecklistTools` — checklist + items|
| `src/tools/comments.ts`       | `registerCommentTools` — card comments      |

Each is wired into `src/tools/register.ts` alongside the existing
`registerCardTools` etc. Client methods are added to `src/trello/client.ts` (its
single responsibility is the typed REST wrapper). New entity types go in
`src/trello/types.ts`.

### Tools exposed

**Attachments** — `src/tools/attachments.ts`

| Tool                | Trello endpoint                                  | Inputs |
| ------------------- | ------------------------------------------------ | ------ |
| `list_attachments`  | `GET /cards/{id}/attachments`                    | `cardId` |
| `attach_url`        | `POST /cards/{id}/attachments` (`url` param)     | `cardId`, `url`, `name?`, `setCover?` |
| `attach_file`       | `POST /cards/{id}/attachments` (multipart `file`)| `cardId`, `filePath?` **xor** `base64?`, `name?` (required with `base64`), `mimeType?`, `setCover?` |
| `delete_attachment` | `DELETE /cards/{id}/attachments/{idAttachment}`  | `cardId`, `attachmentId` |

**Checklists** — `src/tools/checklists.ts`

| Tool               | Trello endpoint                                       | Inputs |
| ------------------ | ----------------------------------------------------- | ------ |
| `list_checklists`  | `GET /cards/{id}/checklists`                          | `cardId` |
| `create_checklist` | `POST /checklists` (`idCard`)                         | `cardId`, `name`, `pos?` |
| `delete_checklist` | `DELETE /checklists/{id}`                             | `checklistId` |
| `add_checkitem`    | `POST /checklists/{id}/checkItems`                    | `checklistId`, `name`, `checked?`, `pos?` |
| `update_checkitem` | `PUT /cards/{idCard}/checkItem/{idCheckItem}`         | `cardId`, `checkItemId`, `name?`, `checked?`, `pos?` |
| `delete_checkitem` | `DELETE /checklists/{id}/checkItems/{idCheckItem}`    | `checklistId`, `checkItemId` |

`checked: boolean` on the tool maps to Trello's `state` = `"complete"`/`"incomplete"`
on update, and to the `checked` param on `add_checkitem`. (`update_checklist`
rename/reposition is deferred — not requested, low value.)

**Comments** — `src/tools/comments.ts`

| Tool             | Trello endpoint                                        | Inputs |
| ---------------- | ------------------------------------------------------ | ------ |
| `list_comments`  | `GET /cards/{id}/actions?filter=commentCard`           | `cardId` |
| `add_comment`    | `POST /cards/{id}/actions/comments` (`text`)           | `cardId`, `text` |
| `update_comment` | `PUT /cards/{idCard}/actions/{idAction}/comments`      | `cardId`, `commentId`, `text` |
| `delete_comment` | `DELETE /cards/{idCard}/actions/{idAction}/comments`   | `cardId`, `commentId` |

### New `TrelloClient` methods (`src/trello/client.ts`)

Most reuse the existing `request<T>(method, path, params)`. Only file upload is new.

```
listAttachments(cardId)                              GET    (request)
attachUrl(cardId, {url, name?, setCover?})           POST   (request)
attachFile(cardId, file, {name?, setCover?})         POST   (NEW multipart path)
deleteAttachment(cardId, attachmentId)               DELETE (request)

listChecklists(cardId)                               GET    (request)
createChecklist(cardId, {name, pos?})                POST   (request)  // idCard param
deleteChecklist(checklistId)                         DELETE (request)
addCheckItem(checklistId, {name, checked?, pos?})    POST   (request)
updateCheckItem(cardId, checkItemId, {name?,state?,pos?})  PUT (request)
deleteCheckItem(checklistId, checkItemId)            DELETE (request)

listComments(cardId)                                 GET    (request)  // filter=commentCard
addComment(cardId, text)                             POST   (request)
updateComment(cardId, commentId, text)               PUT    (request)
deleteComment(cardId, commentId)                     DELETE (request)
```

**Refactor (DRY, no behavior change):** extract the response handling currently inline
in `TrelloClient.request` (`res.text()` → `TrelloApiError` on !ok → empty-body →
`JSON.parse`) into `private async readBody<T>(res, url): Promise<T>`. Both `request`
and the new `attachFile` use it, so error/empty-body semantics stay identical to today.
This extraction is the one refactor in the change; it lands as its own step (plan item 2),
kept separate from the new-tool steps so the diff stays reviewable (no mixed
refactor + behavior in a single opaque blob).

**`attachFile` shape:**

```ts
async attachFile(
  cardId: string,
  file: { data: Buffer; filename: string; mimeType?: string },
  opts: { name?: string; setCover?: boolean } = {},
): Promise<Attachment> {
  const path = `/cards/${encodeURIComponent(cardId)}/attachments`;
  const url = `${this.baseUrl}${path}`;
  const params = stripUndefined({ name: opts.name, mimeType: file.mimeType, setCover: opts.setCover });
  const signed = signRequest(this.creds, { method: "POST", url, params });   // metadata signed
  const target = new URL(url);
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, String(v));
  const form = new FormData();
  form.append("file", new Blob([file.data], file.mimeType ? { type: file.mimeType } : {}), file.filename);
  const res = await this.fetchImpl(target.toString(), {
    method: "POST",
    headers: { Authorization: signed.authorization, Accept: "application/json" }, // NO Content-Type
    body: form,
  });
  return this.readBody<Attachment>(res, target.toString());
}
```

### New types (`src/trello/types.ts`)

```ts
export interface Attachment {
  id: string; name: string; url: string; bytes: number | null;
  date: string; mimeType: string | null; isUpload: boolean; idMember: string; pos: number;
}
export interface CheckItem {
  id: string; name: string; state: "complete" | "incomplete";
  idChecklist: string; pos: number; due: string | null; idMember: string | null;
}
export interface Checklist {
  id: string; name: string; idCard: string; idBoard: string; pos: number; checkItems: CheckItem[];
}
export interface CommentAction {
  id: string; type: string; date: string; idMemberCreator: string;
  data: { text: string; card?: { id: string; name: string } };
}
```

### `attach_file` tool flow (`src/tools/attachments.ts`)

1. Validate input: exactly one of `filePath` / `base64` is present, else `err`. If
   `base64` is present without `name`, `err` ("name is required when using base64").
2. Obtain the bytes + filename:
   - `filePath` → `resolve(filePath, process.cwd())`; `await readFile(abs)` → `Buffer`;
     on `ENOENT` return `err("File not found: <path>")`; `filename = input.name ?? basename(abs)`.
   - `base64` → `Buffer.from(input.base64, "base64")`; `filename = input.name`.
3. `client.attachFile(cardId, { data, filename, mimeType: input.mimeType }, { name: input.name, setCover })`.
4. `return ok(attachment)`.

mimeType is optional; when omitted we send nothing and let Trello sniff it (no in-tree
mime table — avoids a needless dependency/lookup map).

## Implementation Plan

> The endpoint paths, HTTP verbs, and param names in the tables above are drawn from
> Trello's API knowledge, not a live fetch. **Step 0 of coding: confirm each against
> the current Trello REST reference (developer.atlassian.com/cloud/trello/rest).**
> This matters because our tests mock `fetch` — a wrong path would pass a mocked test
> yet 404 against real Trello. Any correction gets noted under Implementation Results.

1. `types.ts`: add `Attachment`, `Checklist`, `CheckItem`, `CommentAction`.
2. `client.ts`: extract `readBody`; add the 14 methods incl. `attachFile` multipart path.
3. `src/tools/{attachments,checklists,comments}.ts`: tool definitions (Zod schemas,
   `ok`/`err`). Reuse `ToolContext.client()`.
4. `register.ts`: wire the three `registerXxxTools` calls.
5. Tests:
   - `tests/client.test.ts`: signed URL + params for each method; **multipart test**
     asserting the file is in the `FormData` body, metadata is in the query string,
     `Authorization` is present, and the file is NOT in the signed query/signature.
   - `tests/server.test.ts`: **update the exact tool-name assertion in the
     `lists all expected tools` test** to include the 14 new names; add end-to-end
     roundtrips for `attach_url`, `attach_file` (temp file on disk), `add_checkitem`,
     `update_checkitem`, `add_comment`, plus unhappy paths: `attach_file` on a
     missing path returns an `err` (not a throw), and a Trello 4xx surfaces as an
     MCP tool error (mirrors the existing 401 test).
6. Docs: extend the tool table in `README.md` and design-log 001's table.
7. `npm run typecheck && npm test` green; then integration check + merge.

## Examples

```jsonc
// Attach a local screenshot, set it as the card cover
attach_file { "cardId": "abc123", "filePath": "./out/screenshot.png", "setCover": true }

// Attach in-memory bytes (base64 requires an explicit name)
attach_file { "cardId": "abc123", "base64": "iVBORw0KGgo...", "name": "diagram.png", "mimeType": "image/png" }

// Attach a reference link
attach_url  { "cardId": "abc123", "url": "https://github.com/org/repo/pull/42", "name": "PR #42" }

// Checklist + item, then tick it off
create_checklist { "cardId": "abc123", "name": "Release steps" }   // -> { id: "cl1", ... }
add_checkitem    { "checklistId": "cl1", "name": "Tag release" }   // -> { id: "ci1", state: "incomplete" }
update_checkitem { "cardId": "abc123", "checkItemId": "ci1", "checked": true }  // state -> complete

// Comment
add_comment { "cardId": "abc123", "text": "Deployed to staging ✅" }
```

## Trade-offs

- **14 tools (full CRUD) vs. a core subset.** Owner chose full surface — the literal
  request and most useful — at the cost of ~doubling tool count (more for the model to
  scan). *Core subset alternative (9), declined:* would have dropped `list_attachments`,
  `delete_attachment`, `list_checklists`, `delete_checkitem`, `update_comment`,
  `delete_comment`.
- **`filePath` + base64 (both, owner-approved).** Covers local-file and in-memory
  callers. Cost: an input-validation branch (xor, and `name` required with base64) and
  base64's ~33% payload inflation when that path is used. `filePath` stays the preferred
  path for non-trivial files.
- **Multipart adds a second client code path.** Unavoidable for binary upload; isolated
  to `attachFile`, and `readBody` keeps response semantics shared with `request`.
- **No mime lookup table.** Trello sniffs content; we avoid a dependency. Cost: the
  attachment's `mimeType` may be generic unless the caller passes one.

## Verification Criteria

- Unit (`client.test.ts`): each new method issues the correct signed `METHOD` + path +
  query params (mirrors existing `createCard` tests). `attachFile` test proves the file
  rides in the multipart body, metadata rides in the (signed) query string, and the
  body is excluded from the OAuth signature.
- Integration (`server.test.ts`): tool-name list matches exactly (updated); in-memory
  MCP client invokes `attach_url`, `attach_file` (real temp file), `add_checkitem`,
  `update_checkitem`, and `add_comment` end-to-end with a mocked `fetch`.
- `npm run typecheck` and `npm test` both green before merge; re-run after merge.

---

## Implementation Results

### What shipped (matches Design)

- `src/trello/types.ts`: added `Attachment`, `Checklist`, `CheckItem`, `CommentAction`.
- `src/trello/client.ts`: extracted `readBody` (byte-identical response handling, reused
  by `request` and `attachFile`); added all 14 methods incl. the multipart `attachFile`.
- `src/tools/attachments.ts` / `checklists.ts` / `comments.ts`: the 14 tools, wired in
  `register.ts`. `attach_file` validates exactly-one-of `filePath`/`base64` and requires
  `name` with `base64`; `update_checkitem` maps `checked` → `state`.
- Tests: `tests/client.test.ts` 6 → 14, `tests/server.test.ts` 18 → 25. **100/100 pass,
  typecheck clean.** The multipart test proves the file is excluded from the OAuth
  signature (its bytes appear in neither the query nor the `Authorization` header).
- Docs: `README.md` tool table extended with the 14 new tools.

**Deviation from plan item 6:** the plan said to also extend design-log 001's tool
table. Skipped on purpose — 001's Design section is frozen under the Immutable History
pillar; rewriting it would falsify the historical record. The new tools live here (004)
and in `README.md`, which is the user-facing source of truth.

### Deviation: one TS fix not in the Design

`new Blob([buffer])` failed typecheck — `@types/node` 22 types `Buffer` as
`ArrayBufferLike`-backed, not assignable to the DOM `BlobPart`. Fixed by re-wrapping as
`new Uint8Array(file.data)` (fresh `ArrayBuffer`-backed view) at the Blob boundary in
`attachFile`. No behavior change; correct at runtime.

### Step 0 (live endpoint verification): DONE via live smoke test

**Resolved.** A throwaway-board smoke test (owner-approved) exercised all 14 endpoints
against real Trello, created and then deleted a scratch board, and caught a real bug the
mocked tests could not:

- **`add_comment` path was wrong.** Coded as `POST /cards/{id}/actionComments` →
  **404 Not Found** (not a valid route). Correct path, confirmed empirically by probing
  candidates: **`POST /cards/{id}/actions/comments`**. Fixed in `client.ts` `addComment`
  and in both test files' assertions.
- `update_comment` / `delete_comment` were already correct
  (`PUT|DELETE /cards/{id}/actions/{idAction}/comments`) — confirmed once a real comment
  id existed (the first run's 404s there were a cascade from the empty id, not bad paths).
- All attachment (URL + multipart file), checklist, and check-item endpoints passed live
  on the first run. Final result: **14/14 endpoints OK.**

Lesson: memory said `actionComments`; live Trello said `actions/comments`. Mocked tests
asserting the coded path are circular — only a live call (or the authoritative spec)
catches a wrong route. The smoke-test script was a one-off and was removed after use.

---

### (superseded) pre-smoke-test status

The plan's Step 0 said "confirm each endpoint against the live Trello reference." This
was **attempted via WebFetch but is not trustworthy**: the doc-summarizer returned three
*conflicting* answers for the comment-create path (`actionComments` vs `actions/comments`
vs "no such endpoint") and contradicted itself on paths it had already returned — it was
reading a truncated view of the large spec. So:

- **No endpoint path should be treated as live-verified.** The mocked unit/integration
  tests assert the paths *as coded*, so they are circular: a wrong path stays green here
  and 404s against real Trello. This applies to ALL new paths, not just comments.
- Paths were coded from Trello REST API knowledge. The one with the lowest confidence is
  `POST /cards/{id}/actionComments` (`addComment`); the rendered reference leaned toward
  `actions/comments`, but the summarizer was demonstrably unreliable.
- **Definitive resolution = a live smoke test** against real Trello (a token is present:
  `~/.trello-connector/tokens.json`, scope `read,write,account`). Pending owner consent
  on where it is safe to write. Results (and any path corrections) will be appended here.

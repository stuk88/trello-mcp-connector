# Installing the Trello connector for Claude Code

This sets up a local MCP server that gives Claude Code a set of Trello tools
(boards, lists, cards, status-based card moves, webhooks). Follow it top to
bottom — it takes a few minutes.

## How auth works (read this first)

There are two different credentials, and it's worth knowing which is which:

- **App credentials**: these identify the *application*, not any person's data.
  They're **already bundled in the connector's code**, so there's nothing to
  paste or configure. They cannot read or write any board on their own.
- **Your personal token**: created when you run `auth_login`. You authorize
  with **your own Trello account** in the browser, and the resulting token is
  stored only on your machine at `~/.trello-connector/tokens.json` (owner-only,
  mode `0600`). This is what actually grants board access.

Consequence: you'll see whatever boards **your** Trello account is a member of.
If a board you expect is missing, you haven't been added to it — fix that in
Trello, not here.

## Prerequisites

- **Node.js ≥ 20** — check with `node --version`.
- **Claude Code** — check with `claude --version`.
- **git**.

## 1. Clone and build

```sh
git clone https://github.com/stuk88/trello-mcp-connector.git
cd trello-mcp-connector
npm install
npm run build          # compiles TypeScript into dist/index.js
```

`dist/` and `node_modules/` are gitignored, so the build step is required —
the connector won't run from a fresh clone without it.

Print the absolute path to the built entrypoint; you'll paste it in step 2:

```sh
echo "$(pwd)/dist/index.js"
```

## 2. Register the connector with Claude Code

The app credentials are baked into the connector, so registration is just the
path to the built server:

```sh
claude mcp add trello --scope user -- node /ABSOLUTE/PATH/TO/trello-mcp-connector/dist/index.js
```

- Replace `/ABSOLUTE/PATH/TO/.../dist/index.js` with the path printed in step 1.
- `--scope user` makes the connector available in every project. Drop it to
  scope it to the current directory only.
- On Windows, use the Windows-style path (e.g.
  `C:\Users\you\trello-mcp-connector\dist\index.js`) and make sure `node` is on
  your `PATH`.

**Alternative — edit the config by hand.** Add this under `mcpServers` in
`~/.claude.json`:

```json
"trello": {
  "type": "stdio",
  "command": "node",
  "args": ["/ABSOLUTE/PATH/TO/trello-mcp-connector/dist/index.js"]
}
```

## 3. Restart Claude Code and confirm the connection

Restart Claude Code, then:

```sh
claude mcp list
```

`trello` should appear in the list. Inside a session you can also run `/mcp`.

## 4. Authorize your Trello account

In a Claude Code session, ask Claude to **"log in to Trello"** (it calls the
`auth_login` tool), or invoke the tool directly. Then:

1. A browser tab opens at Trello's authorize page. (If it doesn't open
   automatically, the authorize URL is printed in the tool output — open it
   manually.)
2. Approve access for **"Trello MCP Connector"** (default scope: read, write,
   account; no expiry).
3. The tab shows **"Authorized"** and your token is saved locally.

> **Leave the callback port at its default (51823).** The app's "Allowed
> Origins" is already registered for `http://127.0.0.1:51823`. If you set
> `TRELLO_OAUTH_CALLBACK_PORT` to anything else, Trello rejects the redirect
> with `Invalid return_url`.

## 5. Smoke test

Ask Claude:

- *"What's my Trello auth status?"* → `auth_status` should report
  `authenticated: true`.
- *"List my Trello boards."* → `list_boards` should return the boards your
  account can see.

If a board is missing, your Trello account isn't a member of it.

## Updating an existing install

Already set up from a previous version? Pull the latest code and rebuild.
There's **nothing to re-register and no need to re-authorize** — the registered
path (`dist/index.js`) and your saved token (`~/.trello-connector/tokens.json`)
don't change.

```sh
cd /path/to/trello-mcp-connector   # the directory you cloned in step 1
git pull
npm install        # only does anything if dependencies changed
npm run build      # recompile dist/ — required, since dist/ is gitignored
```

Then **restart Claude Code** so it relaunches the MCP server from the freshly
built `dist/`. A running session keeps using the old build until you restart.

Confirm the update with `/mcp` (or `claude mcp list`), then try a newer tool —
e.g. ask Claude to *"list the attachments on card X"*, *"add a checklist item"*,
or *"comment on card Y"*.

## Optional: a default board for a project

Drop a `trello.config.json` at a project root so you don't have to pass ids
every time. All fields are optional:

```json
{ "orgId": "...", "boardId": "...", "listId": "..." }
```

These ids are public (they appear in Trello URLs). Tools fall back to them when
you omit `orgId` / `boardId` / `listId`. Run the `project_config` tool to see
what's currently loaded.

## Optional: the `/trello-update` slash command

There's a Claude Code skill that lets you say *"move card X to QA"* and have
Claude move the card to the matching list by status. It is **not** bundled in
this repo — ask Stas for the `SKILL.md`, then place it at:

```
~/.claude/skills/trello-update/SKILL.md
```

The `move_card_by_status` MCP tool works without the skill; the skill is just a
convenience wrapper around it.

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| `Invalid return_url` during login | Callback port isn't `51823`. Remove any `TRELLO_OAUTH_CALLBACK_PORT` override. |
| `auth_status` reports not authenticated | Run `auth_login` again; confirm `~/.trello-connector/tokens.json` was created. |
| `trello` missing from `claude mcp list` | Re-run step 2; verify the path to `dist/index.js` is correct and that `npm run build` succeeded. |
| `node: command not found` or version errors | Install Node.js ≥ 20 and make sure it's on your `PATH`. |

## Revoking access

To remove your personal token from this machine, ask Claude to run
`auth_logout` (deletes `~/.trello-connector/tokens.json`). You can also revoke
the app from your Trello account settings at any time.

# Connecting agents

Agents use the same operations as the app, through MCP at `/api/mcp` or REST at `/api/v1`. Authentication is a bearer token.

## Get a token

In the app, open the agents panel, or on the server:

```bash
./family token create --name my-agent --role editor --days 30
```

The output includes the ready command for Claude Code:

```bash
claude mcp add --transport http family https://your.domain/api/mcp --header "Authorization: Bearer fg_..."
```

Other clients take this config:

```json
{ "mcpServers": { "family": { "type": "http", "url": "https://your.domain/api/mcp", "headers": { "Authorization": "Bearer fg_..." } } } }
```

Clients that accept only OAuth, such as some hosted connectors, cannot connect yet: the server supports bearer tokens.

## What a token can do

| | Reads | Writes |
|---|---|---|
| `--role reader` | Everything except living relatives, like a reader in the app | None; write tools are not even listed |
| `--role editor` | Everything, including living relatives | Queued as drafts for your review |
| `--role editor --direct` | Everything | Applied at once and recorded in history. Bulk imports are still reviewed |

Use one token per agent, so its name shows up in history and you can cut it off alone. `--days N` makes it end by itself. `./family token revoke ID` ends it now. Tokens are stored hashed and shown only once.

## Good to know

- `get_overview` and `find_gaps` are the best first calls for an agent. Prompts `research_person`, `fill_gaps` and `import_notes` set up common jobs.
- Every applied change can be undone, by you in the history panel or by an agent with `undo`.
- An agent reads what is written in your archive, and imported text can contain anything. Give an agent that also reads the web or other untrusted material a reader token, or leave review on.

Tool list, REST and formats: [AI_AND_FORMATS.md](AI_AND_FORMATS.md).

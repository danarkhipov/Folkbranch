# Connecting agents

Agents use the same operations as the app, through MCP at `/api/mcp` or REST at `/api/v1`. Authentication is a bearer token.

## The assistant inside the app

A chat panel for people signed in to the app. The owner pastes a provider's key right in the panel, where it is checked and kept encrypted in the database, or sets one on the server (see `.env.example`: Anthropic, OpenRouter, OpenAI, Google, Yandex AI Studio, Cloud.ru, DeepSeek, Moonshot, or a local model), then the owner turns it on under **Settings → Assistant**. It is off by default.

- What it reads in the archive is sent to the model's provider. It works as the person talking to it, with everything they can see, living relatives included. Photos in the archive are not sent.
- It acts as the person talking to it, with their role. Ordinary edits ask first, or can be allowed for one conversation. Deleting, importing, undoing and settings always ask.
- Each answer's edits can be undone with one button, and show in history as `Assistant → name`.

Files attached in the chat go to the provider too, and stay out of the archive until the person allows saving them. `AGENT_PROVIDER` and `AGENT_MODEL` choose what answers.

## Get a token

In the app, open **Settings → Agents and MCP**, or on the server:

```bash
./folkbranch token create --name my-agent --role editor --days 30
```

The output includes the ready command for Claude Code:

```bash
claude mcp add --transport http folkbranch https://your.domain/api/mcp --header "Authorization: Bearer fb_..."
```

Other clients take this config:

```json
{ "mcpServers": { "folkbranch": { "type": "http", "url": "https://your.domain/api/mcp", "headers": { "Authorization": "Bearer fb_..." } } } }
```

Clients that accept only OAuth, such as some hosted connectors, cannot connect yet: the server supports bearer tokens.

## What a token can do

| | Reads | Writes |
|---|---|---|
| `--role reader` | Everything except living relatives, like a reader in the app | None; write tools are not even listed |
| `--role editor` | Everything, including living relatives | Queued as drafts for your review |
| `--role editor --direct` | Everything | Applied at once and recorded in history. Bulk imports are still reviewed |

Use one token per agent, so its name shows up in history and you can cut it off alone. `--days N` makes it end by itself. `./folkbranch token revoke ID` ends it now. Tokens are stored hashed and shown only once.

## Good to know

- `get_overview` and `find_gaps` are the best first calls for an agent. Prompts `research_person`, `fill_gaps` and `import_notes` set up common jobs.
- Every applied change can be undone, by you in the history panel or by an agent with `undo`.
- An agent reads what is written in your archive, and imported text can contain anything. Give an agent that also reads the web or other untrusted material a reader token, or leave review on.

Tool list, REST and formats: [AI_AND_FORMATS.md](AI_AND_FORMATS.md).

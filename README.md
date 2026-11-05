# Folkbranch

A self-hosted home for your family history: a clear family tree, a Notion-style page with photos for every relative, shared editing by invitation, and AI agents that work on the archive through MCP without seeing what they should not.

[Русская версия](README.ru.md)

- **The tree:** generations on one screen, add a relative from any side of a card, jump to anyone, see how two people are related.
- **Pages:** rich text with photos, links to relatives, tags, sources, and marks for unverified paragraphs.
- **Your data stays yours:** one SQLite file and a folder of photos on your own server. GEDCOM, Excel, CSV, JSON and plain text go in and come out.
- **Privacy by default:** readers and read-only agents do not see living relatives, and this is enforced on the server.
- **Agents:** MCP and REST with tokens you can limit, expire and revoke. Their edits wait for your review unless you decide otherwise. Every change can be undone.

## Install

You need [Docker](https://docs.docker.com/get-docker/).

```bash
git clone <this repository> folkbranch
```

```bash
cd folkbranch && ./install.sh
```

The script prints a link. Open it, name your family, and you are the owner. Use `./install.sh --domain family.example.com` on a server: it obtains an HTTPS certificate by itself. More options, backups and updates: [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

Hosting on Railway instead: see [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md#railway).

## Connect an agent

```bash
./family token create --name my-agent --role editor
```

It prints the token and the exact command for Claude Code, plus a config for any other MCP client. You can do the same in the app under **Agents**. Roles and what an agent can do: [docs/AGENTS.md](docs/AGENTS.md).

## Develop

```bash
pnpm install && pnpm dev
```

The app opens on http://localhost:3417 with its data in `./data`. See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

[AGPL-3.0](LICENSE). Found a vulnerability? See [SECURITY.md](SECURITY.md).

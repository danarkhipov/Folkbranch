# Folkbranch

[![CI](https://github.com/danarkhipov/folkbranch/actions/workflows/ci.yml/badge.svg)](https://github.com/danarkhipov/folkbranch/actions/workflows/ci.yml) [![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

A self-hosted home for your family history: a clear family tree, a Notion-style page with photos for every relative, shared editing by invitation, and AI agents that work on the archive through MCP without seeing what they should not.

[Русская версия](README.ru.md)

![The family chart with a person's card open](docs/images/chart.png)

![First run: what is set up and what is missing](docs/images/onboarding.png)

- **The tree:** generations on one screen, add a relative from any side of a card, jump to anyone, see how two people are related.
- **Pages:** rich text with photos, links to relatives, tags, sources, and marks for unverified paragraphs.
- **Your data stays yours:** one SQLite file and a folder of photos on your own server. GEDCOM, Excel, CSV, JSON and plain text go in and come out.
- **Privacy by default:** readers and read-only agents do not see living relatives, and this is enforced on the server.
- **Agents:** MCP and REST with tokens you can limit, expire and revoke. Their edits wait for your review unless you decide otherwise. Every change can be undone.

## Install

You need [Docker](https://docs.docker.com/get-docker/). One command, on your computer:

```bash
curl -fsSL https://raw.githubusercontent.com/danarkhipov/folkbranch/main/install.sh | sh
```

It downloads a ready image and prints a link. Open it, name your family, and the app shows what else can be set up and what is missing. It runs on about 130 MB of memory. On a server, with automatic HTTPS:

```bash
curl -fsSL https://raw.githubusercontent.com/danarkhipov/folkbranch/main/install.sh | sh -s -- --domain family.example.com
```

**Let your agent do it.** Tell Codex, Claude Code or any other agent:

> Install Folkbranch following https://raw.githubusercontent.com/danarkhipov/folkbranch/main/skills/folkbranch/SKILL.md

Backups, updates and hosting on Railway: [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

## Connect an agent

```bash
cd ~/folkbranch && ./family connect
```

It makes a key and connects the Claude Code or Codex it finds on this computer over MCP. For Cursor, Windsurf and others, the app gives the exact text to paste: **Settings → Agents and MCP**. Edits wait for your review unless you decide otherwise. Roles and what an agent can do: [docs/AGENTS.md](docs/AGENTS.md).

## Develop

```bash
pnpm install && pnpm dev
```

The app opens on http://localhost:3417 with its data in `./data`. Branches: `main` is what is released, work goes to `develop`. See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

[AGPL-3.0](LICENSE). Found a vulnerability? See [SECURITY.md](SECURITY.md).

Company and product names and logos in the app belong to their owners and only say which service is meant.

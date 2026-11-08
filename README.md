<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo-dark.svg">
    <img src="docs/brand/logo.svg" alt="" width="96" height="96">
  </picture>
</p>

# Folkbranch

**Your family's tree, photos and stories on a small server of your own, where relatives join from their phones with a link.**

Free and open source. One command installs it, with no Docker, and it runs in about 70 MB of memory.

[![CI](https://github.com/danarkhipov/folkbranch/actions/workflows/ci.yml/badge.svg)](https://github.com/danarkhipov/folkbranch/actions/workflows/ci.yml) [![Release](https://img.shields.io/github/v/release/danarkhipov/folkbranch)](https://github.com/danarkhipov/folkbranch/releases) [![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

[Install](#install) · [Features](#features) · [Compare](#how-it-compares) · [What it does not do](#what-it-does-not-do) · [AI agents](#ai-agents) · [FAQ](#faq) · [На русском](README.ru.md)

![Opening a relative's page, adding a son on the chart, and seeing the change in history](docs/images/demo.gif)

## Why families pick it

- **Relatives join with a link.** No password to remember. They see the chart labelled from where they stand: "your grandfather", "your aunt".
- **A grandmother can tell a story with one button.** Send her a link: no account, one big button, and her voice waits for your review before it joins the archive.
- **Relatives get a copy that needs nothing.** One file with the chart, cards and photos opens in any browser, with no server and no internet, and the living stay hidden.
- **The living stay private.** Readers, guests and read-only agents never see living relatives, or anyone and any story you choose to keep private. The server enforces it, not the page.
- **Nothing is lost.** Every change is in the history and can be rolled back. Disagreeing dates keep their sources side by side.

## Install

On a Mac or Linux computer, one command. It needs nothing else: no Docker, and no Node either, since it brings its own.

```bash
curl -fsSL https://raw.githubusercontent.com/danarkhipov/folkbranch/main/install.sh | sh
```

It prints a link. Open it, name your family, and load the invented demo family if you want to look around first.

On any Linux server, with HTTPS that sets itself up and an app that starts with the server. No Docker, and no domain needed:

```bash
curl -fsSL https://raw.githubusercontent.com/danarkhipov/folkbranch/main/install.sh | sudo sh -s -- --server
```

Add `--domain family.example.com` for your own domain. It is tested on Ubuntu, Debian, AlmaLinux, Rocky, Fedora and Amazon Linux, through a reboot, with 512 MB of memory.

<details>
<summary>Other ways: npx, Docker, an AI agent, Windows</summary>

- With Node at hand: `npx folkbranch`. Run it again to open the app.
- With Docker on a server: `... | sh -s -- --domain family.example.com` runs the image with automatic HTTPS.
- In Claude Code: `/plugin marketplace add danarkhipov/folkbranch`, then `/plugin install folkbranch@folkbranch`, and ask it to install Folkbranch. Codex or another agent: *"Install Folkbranch following https://raw.githubusercontent.com/danarkhipov/folkbranch/main/skills/folkbranch/SKILL.md"*.
- Windows: an installer exists, `install.ps1`, but it has not been tried on a real Windows machine yet. Docker is the sure way there.

</details>

Backups, updates, servers and Railway: the [self-hosting guide](docs/SELF_HOSTING.md).

## Features

**The tree**
- All generations on one screen, with each relative labelled from the person you open.
- Add a relative from any side of a card, or drag a line between two people.
- See how two people are related, and the path between them.
- An ancestor fan for anyone: the whole line in one picture.
- Dates and numbers: birthdays and anniversaries of the coming two months, the family in figures, and a file for the calendar on a phone.
- Save views of a branch. Print the chart to PDF on one sheet or across several.

**A page for every relative**
- A block editor with headings, photos in the text and links to other relatives.
- A life in order, read from the card: birth, marriage, children, facts and death.
- Disagreeing versions of a date or place, each with its source, so nothing is overwritten.
- Tag people on photos, record voice stories, or type what someone told you.
- Print a person, or keep them as a PDF: life, family, facts, biography, stories and sources on a page or two.
- Find and merge duplicate cards, with undo.

**For the whole family**
- Ask for a story with up to five questions. The relative picks one, answers, and goes on to the next.
- Owner, editor and reader roles. Readers suggest corrections for you to accept.
- Keep a person who died, or a single story, from readers.
- A view-only link, with an optional password and an expiry date.
- Works in a browser on a phone or a computer, in English or Russian.

**Your data stays yours**
- One SQLite file and a folder of photos on your server. No telemetry, and closed to search engines.
- Import GEDCOM 5.5.1 and 7.0, Excel, CSV, JSON and plain text. Export GEDCOM or a full copy of the archive. [Moving from Gramps or webtrees](docs/MOVING.md) is checked on their own kind of files.
- The server copies the database each day by itself, and the settings say when it last did.
- Bring in a research case from the [ex-USSR kinship skill](https://github.com/DenisSergeevitch/ex-ussr-kinship-research): what was proved goes on the chart, the rest stays a note.

**On this device, if you want it**
- Faces in photos are found and recognised from the ones you already tagged. A name appears only when you confirm it.
- Speech becomes text for stories and for talking to the assistant, with GigaAM for Russian or Whisper.
- Nothing downloads until you press the button, and photos and voice stay on the device.

![The family chart with a person's biography open](docs/images/chart.png)

## How it compares

Folkbranch is for a family building its history together. [Gramps Web](https://www.grampsweb.org/) and [webtrees](https://webtrees.net/) are mature projects with more genealogy tools: maps, reports and, in Gramps Web, DNA.

| | Folkbranch | Gramps Web | webtrees |
|---|---|---|---|
| What it takes to run | One command on Mac or Linux, no Docker. One process, SQLite built in | Docker Compose: web, Celery and Redis | PHP and a database: MySQL, MariaDB, PostgreSQL, SQLite or SQL Server |
| Memory | About 70 MB at rest, 130 MB under load¹ | About 1.5 GB, or 800 MB with two workers¹ | About 250 MB¹ |
| Relatives join | With a link, no password | — | — |
| A relative tells a story | ✓ A link, one button, no account. You review it first | — | — |
| A copy for relatives | ✓ One HTML file, no server or internet, the living hidden | — | — |
| Privacy | The living, and anyone or any story you choose, hidden from readers, guests and agents, on the server | — | ✓ Access levels and privacy per person, moderated edits |
| History and undo | ✓ Every change, rolled back from the card or the history | ✓ Revision history² | — |
| Charts | Whole family on one screen, ancestor fan, relationship path, PDF | ✓ Ancestor, descendant, hourglass, relationship, fan | ✓ Charts and reports |
| Reports | The chart, and a person's page, in PDF | ✓ | ✓ |
| Maps | ✗ | ✓ OpenHistoricalMap | ✓ Interactive |
| DNA | ✗ | ✓ Matches, chromosome browser | —³ |
| Faces in photos | ✓ On your device, a model you choose to download | ✓ Tagging and face detection⁴ | — |
| AI | MCP server and assistant built in; an agent's edits wait for review | Chat assistant built in; MCP from third parties | Not built in |
| On a phone | Bottom bar, card as a sheet, offline page, about 311 KB on first load | — | Adapted for phones in 2.2 |
| Languages | 2 | 40+ | 50+ |
| Several trees | ✗ | — | ✓ |
| Sync with a desktop program | ✗ | ✓ Gramps Desktop | — |
| Hosting for you | ✗ | ✓ Paid, Grampshub | — |

"—" means we have not checked, not that it is missing. Each project's own documentation is the authority. Gramps Web as of docs 26.6 and release 26.4.0, webtrees as of 2.2.6.

¹ Folkbranch: our own measurement under a 256 MB limit, with 8 uploads, 40 page views and an import. The others: [selfhosting.sh](https://selfhosting.sh/compare/webtrees-vs-gramps-web), February 2026.
² Listed in the Gramps Web docs. Whether a change can be rolled back from the screen was not checked.
³ Not checked for webtrees.
⁴ A project issue reports up to 12 GB of memory with face recognition on, 4 GB without. Not verified.

**Choose Gramps Web** if you use Gramps Desktop, need maps, DNA or reports, or want someone to host it for you.
**Choose webtrees** if you need access levels, several trees in one place, modules or more languages.
**Choose Folkbranch** if you want it running on a small machine in one command, and relatives adding to it from their phones without passwords.

## What it does not do

- No DNA tools and no maps.
- No reports beyond the chart and a person's page in PDF. A family book is on the [roadmap](docs/ROADMAP.md).
- One tree per install, in two languages.
- No sync with desktop programs, and no plugins.
- No hosted version: you run it yourself, at home or on a server.

## AI agents

```bash
cd ~/folkbranch && ./folkbranch connect
```

This makes a key and connects the Claude Code or Codex it finds on your computer over MCP. For Cursor, Windsurf and others, the app gives the exact text to paste under **Settings → Outside programs**.

Then ask your agent something like *"Find what is missing in the archive and suggest sources"*. Each proposed edit shows in words, and you accept or reject it. An optional assistant in the app uses your own key for OpenRouter, Anthropic, OpenAI or Google. Roles and tools are in the [agents guide](docs/AGENTS.md).

## FAQ

**Is it free?**
Yes, under AGPL-3.0. You pay only for your own server, if you use one. The optional assistant uses your own key with an AI provider, which you pay directly.

**Can I move my tree from Ancestry, MyHeritage or Gramps?**
Yes, if the service exports GEDCOM. Folkbranch shows what the file holds before anything changes. GEDCOM carries people, links, events and sources, but not photos. See [moving from Gramps or webtrees](docs/MOVING.md).

**Who can see my family's data?**
Only people you invite. The site is closed to search engines, photos need a sign-in, and readers do not see living relatives.

**Does anything leave my server?**
Not by itself. Connecting an AI provider sends what the assistant reads to that provider, and the app says so first. A model for faces or speech downloads to the browser only when you press its button.

**What does it need to run?**
A Mac or Linux computer, or any Linux server with 512 MB of memory. The app itself stays near 130 MB with a family of a thousand and twenty people looking.

**How do I back it up?**
The server copies the database by itself each day and keeps the last seven, and before each update that changes it. Those copies are on the same disk, so also download a full copy under **Settings → Data and backups**, or run `./folkbranch backup`, and keep it elsewhere.

## Documentation

- [Self-hosting](docs/SELF_HOSTING.md): install, servers, domains, Railway, backups, updates
- [Agents](docs/AGENTS.md): keys, roles, the assistant
- [AI and formats](docs/AI_AND_FORMATS.md): MCP tools, REST API, the text format, GEDCOM
- [Architecture](docs/ARCHITECTURE.md): how it is built, and why
- [Roadmap](docs/ROADMAP.md) and [changelog](CHANGELOG.md)

## Contributing

```bash
pnpm install && pnpm dev
```

The app opens on http://localhost:3417 with its data in `./data`. `main` is what is released, and work goes to `develop`. See [CONTRIBUTING.md](CONTRIBUTING.md). Found a vulnerability? See [SECURITY.md](SECURITY.md).

## License

[AGPL-3.0](LICENSE). Company and product names and logos in the app belong to their owners and only say which service is meant.

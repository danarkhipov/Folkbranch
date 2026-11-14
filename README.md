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

- **Relatives join with a link.** No password to remember. They see the chart labelled from where they stand: "your grandfather", "your aunt". After that they sign in with Yandex ID, VK ID, Telegram, Google or a code by mail, whichever you switch on.
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
- Windows: an archive and an installer, `install.ps1`, are built and started on a Windows build server with every release, but nobody has tried them on a real Windows computer yet. Docker is the sure way there.

</details>

Backups, updates, servers and Railway: the [self-hosting guide](docs/SELF_HOSTING.md).

## Features

**The tree**
- All generations on one screen, with each relative labelled from the person you open.
- Add a relative from any side of a card, or drag a line between two people.
- See how two people are related, and the path between them.
- An ancestor fan for anyone: the whole line in one picture.
- Places with what they were part of, their old names and a point on a map, so a search for "Tsaritsyn" finds people from Volgograd.
- Dates and numbers: birthdays and anniversaries of the coming two months, the family in figures, and a file for the calendar on a phone.
- Save views of a branch. Print the chart to PDF on one sheet or across several.
- Right-click the chart: on a person to open, add a parent, a spouse or a child, or delete; on an empty place to add someone there or load a file. Hover a person and their whole line lights up.

**A page for every relative**
- A block editor with headings, photos in the text and links to other relatives.
- A life in order, read from the card: birth, marriage, children, facts and death, and its places on a map.
- Disagreeing versions of a date or place, each with its source, so nothing is overwritten.
- Facts with fields of their own (a unit and rank for military service), and the people at an event in their roles: godparents, witnesses, a priest.
- Sources with the record number, the document's date, a transcription and the archive that keeps it.
- Tag people on photos, record voice stories, or type what someone told you.
- Print a person, or keep them as a PDF: life, family, facts, biography, stories and sources on a page or two.
- Find and merge duplicate cards, with undo.

**For the whole family**
- Ask for a story with up to five questions. The relative picks one, answers, and goes on to the next.
- Owner, editor and reader roles. Readers suggest corrections for you to accept.
- Sign in with Yandex ID, VK ID, Telegram, Google or a code by mail, each switched on in the settings with its steps on the screen. See [ways to sign in](docs/SIGN_IN.md).
- Keep a person who died, or a single story, from readers. Addresses and phones of the living are for editors only.
- A view-only link, with an optional password and an expiry date.
- Works in a browser on a phone or a computer, in English, Russian, Spanish or Catalan (Spanish and Catalan show English where a word is not translated yet). A short guide shows a new person what the app can do on the first visit.

**Your data stays yours**
- One SQLite file and a folder of photos on your server. No telemetry, and closed to search engines.
- Import GEDCOM 5.5.1 and 7.0, Excel, CSV, JSON and plain text: add to the family, merge with the people already there, or replace it all, and bring the photos together with the file. Export GEDCOM or a full copy of the archive. [Moving from Gramps or webtrees](docs/MOVING.md) is checked on their own kind of files.
- The server copies the database each day by itself, and the settings say when it last did.
- Bring in a research case from the [ex-USSR kinship skill](https://github.com/DenisSergeevitch/ex-ussr-kinship-research): what was proved goes on the chart, the rest stays a note.

**On this device, if you want it**
- Faces in photos are found and recognised from the ones you already tagged. A name appears only when you confirm it.
- Speech becomes text for stories and for talking to the assistant, with GigaAM for Russian or Whisper.
- Or the owner connects a speech service once (OpenRouter, Groq, OpenAI, Mistral or a server of their own) and pays for it, so every editor can dictate. The recording is forwarded and kept nowhere.
- Nothing downloads until you press the button. Photos stay on the device, and so does the voice unless the owner connects a speech service.

![The family chart with a person's biography open](docs/images/chart.png)

## How it compares

Folkbranch is for a family keeping its history together on a server of its own. [Gramps Web](https://www.grampsweb.org/) and [webtrees](https://webtrees.net/) are mature open source projects with more tools for research. MyHeritage, Ancestry and FamilySearch are services you go to for their record collections, and they are compared [further down](#and-the-big-services).

| | Folkbranch | Gramps Web | webtrees |
|---|---|---|---|
| **Running it** | | | |
| What it takes | One command on Mac or Linux, no Docker. One process with SQLite, about 70 MB of memory¹ | Docker Compose: the app, Celery and Valkey | PHP and a web server, with SQLite or another database |
| **The family** | | | |
| Relatives join | ✓ With a link, no password or email. Then Yandex ID, VK ID, Telegram, Google or a code by mail, whichever you switch on | A password, or a sign-in service you set up | A user name and password |
| Read without an account | ✓ A link, with a password and an expiry if you want | ✗ Every reader signs in | ✓ Public pages, open to anyone |
| A relative tells a story | ✓ A link with your questions, one button to talk, no account. You review it first | Upload a recording made elsewhere | Upload a recording made elsewhere |
| A page for each person | ✓ Block editor, photos in the text, links to relatives | ✓ Formatted notes with images, and a blog | Notes, and an HTML block |
| Suggested edits wait for review | ✓ From readers and agents | ✗ Contributors add directly | ✓ Moderated edits, set per user |
| History and undo | ✓ Any change, rolled back from the card | ✓ Changes compared and undone | Partly: history, and pending edits can be rejected |
| The living kept private | ✓ On the server, along with anyone or any story you choose | ✓ Private marks on records | ✓ Privacy rules, per person and by relationship |
| A copy that needs nothing | ✓ One HTML file with the chart, cards and photos, the living left out | Reports in PDF and HTML | Reports in PDF and HTML |
| **AI, on your terms** | | | |
| AI agents over MCP | ✓ Built in. An agent's edits wait for review | A third-party server, reads and writes | A third-party module, writes are moderated |
| An assistant in the app | ✓ Reads and edits after you confirm. Your key or a local model | ✓ A chat that only reads. Your key or a local model | ✗ |
| Faces in photos | ✓ Found and matched to tagged people on your device. You confirm each name | ✓ Found on the server, named by hand | Tagged by hand, with a module |
| Speech to text | ✓ On your device: GigaAM for Russian, Whisper for others, or a speech service you pay for | ✗ | ✗ |
| **Where they go further** | | | |
| Charts | Whole family on one screen, or a person's ancestors or descendants. Ancestor fan, relationship path, PDF | ✓ Ancestors, descendants, hourglass, fan, relationships | ✓ Fan, hourglass, relationships and more |
| Reports and books | The chart and a person's page in PDF. The assistant drafts a life story from the sources, for you to review | ✓ Many reports | ✓ Many reports |
| Maps and timelines | ✓ The family's places on a map, and each life's places in order. The map shows once this device allows OpenStreetMap | ✓ Maps and timelines | ✓ Maps and timelines |
| Reading documents | ✓ The assistant reads scans, handwriting included, and proposes what they show with the document as the source. Needs a model that sees pictures | ✓ Tesseract on the server | ✗ |
| DNA | ✗ | ✓ Matches, chromosome browser, Y-DNA | Stores DNA notes only |

Checked on 8 November 2026 against the code and official documentation: Gramps Web 26.11.1 with its API 3.25.2, and webtrees 2.2.6. Third-party servers and modules are named as such. "—" means we have not checked, not that it is missing. Each project's own documentation is the authority.

¹ Our own measurement, under a 256 MB limit with 8 uploads, 40 page views and an import. We have not measured the others on the same work, so no figures are given for them.

**Choose Gramps Web** if you use Gramps Desktop, need DNA or many kinds of reports, or want someone to host it for you.
**Choose webtrees** if you publish your research for others, need fine access rules, several trees, modules or many languages.
**Choose Folkbranch** if the archive is for the family: running on a small machine in one command, relatives joining from their phones without passwords, and AI that only proposes.

### And the big services

MyHeritage, Ancestry and FamilySearch hold billions of records, DNA tests and other people's trees. Folkbranch has none of that. They also do more for families than is often thought:

- **Without an account.** Ancestry's *Ask someone for info* lets anyone send facts or photos by a link, for the owner to accept. A MyHeritage family site can be public to guests, with the living hidden.
- **Voice.** MyHeritage MyStories records in the browser and writes the words down. FamilySearch records up to five minutes in the browser, Ancestry in its app.
- **AI.** MyHeritage GAIA, out since 4 November 2026, finds records and lets you choose what goes into the tree. FamilySearch and Ancestry suggest relatives and records for you to accept, and MyHeritage and Ancestry read handwritten documents.

What differs is where the archive lives and who decides. Here it is your server, your relatives join without accounts with a service, faces and speech are handled on the device, and any agent you connect only proposes. The two go together: research there, export GEDCOM, and keep the family's archive here.

## What it does not do

On purpose, because it needs what a family server does not have:

- **No record collections or hints.** They take billions of scanned records and licences. Search them on FamilySearch or Ancestry, or let an agent do it through third-party MCP servers for them.
- **No DNA.** It needs a lab test and holds the most sensitive data there is. Gramps Web does it well.
- **No world tree and no matching with strangers.** It needs millions of users, and this archive is closed to search engines and to strangers by design.
- **No hosted version.** You run it yourself, at home or on a server.
- **No photo animation.** It does not help a family keep its history, and it puts words in the mouths of the dead.

Not yet, and maybe later:

- No reports beyond the chart and a person's page in PDF. A family book is on the [roadmap](docs/ROADMAP.md).
- One tree per install, in four languages.
- No sync with desktop programs, and no plugins.

## AI agents

```bash
cd ~/folkbranch && ./folkbranch connect
```

This makes a key and connects the Claude Code or Codex it finds on your computer over MCP. For Cursor, Windsurf and others, the app gives the exact text to paste under **Settings → Outside programs**.

Then ask your agent something like *"Find what is missing in the archive and suggest sources"*. Each proposed edit shows in words, and you accept or reject it. An optional assistant in the app uses your own key for OpenRouter, Anthropic, OpenAI, Google, Yandex AI Studio, Cloud.ru (GigaChat), DeepSeek or Moonshot (Kimi). It lists the models the service really has, recommends cheap ones we tested ([results](docs/MODEL_BENCHMARK.md)), can keep to the newest of them by itself, and if the service takes a model away, another takes its place. Roles and tools are in the [agents guide](docs/AGENTS.md).

## FAQ

**Is it free?**
Yes, under AGPL-3.0. You pay only for your own server, if you use one. The optional assistant and cloud speech use your own keys with their providers, which you pay directly.

**Can I move my tree from Ancestry, MyHeritage or Gramps?**
Yes, if the service exports GEDCOM. Folkbranch shows what the file holds before anything changes. GEDCOM carries people, links, events and sources, but not the photos themselves: drop the pictures together with the file and they are attached to the right people. See [moving from Gramps or webtrees](docs/MOVING.md).

**Who can see my family's data?**
Only people you invite. The site is closed to search engines, photos need a sign-in, and readers do not see living relatives.

**Does anything leave my server?**
Not by itself. Connecting an AI provider sends what the assistant reads to that provider, and the app says so first. Cloud speech, if the owner connects it, sends each recording to that service. A model for faces or speech downloads to the browser only when you press its button. The map's pictures come from OpenStreetMap once a device allows it, which then sees the part of the world on screen, not names or dates.

**What does it need to run?**
A Mac or Linux computer, or any Linux server with 512 MB of memory. The app itself stays near 130 MB with a family of a thousand and twenty people looking.

**How do I back it up?**
The server copies the database by itself each day and keeps the last seven, and before each update that changes it. Those copies are on the same disk, so also download a full copy under **Settings → Data and backups**, or run `./folkbranch backup`, and keep it elsewhere.

## Documentation

- [Self-hosting](docs/SELF_HOSTING.md): install, servers, domains, Railway, backups, updates
- [Ways to sign in](docs/SIGN_IN.md): Yandex ID, VK ID, Telegram, Google, a code by mail
- [Agents](docs/AGENTS.md): keys, roles, the assistant
- [AI and formats](docs/AI_AND_FORMATS.md): MCP tools, REST API, the text format, GEDCOM
- [Model tests](docs/MODEL_BENCHMARK.md): which assistant models were tried, and how they did
- [Architecture](docs/ARCHITECTURE.md): how it is built, and why
- [Releasing](docs/RELEASING.md): how a version is chosen and a release is cut
- [Roadmap](docs/ROADMAP.md) and [changelog](CHANGELOG.md)

## Contributing

```bash
pnpm install && pnpm dev
```

The app opens on http://localhost:3417 with its data in `./data`. `main` is what is released, and work goes to `develop`. See [CONTRIBUTING.md](CONTRIBUTING.md). Found a vulnerability? See [SECURITY.md](SECURITY.md).

## License

[AGPL-3.0](LICENSE). Company and product names and logos in the app belong to their owners and only say which service is meant.

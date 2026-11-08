# Changelog

All notable changes are listed here, newest first. Versions follow [Semantic Versioning](https://semver.org). Each version is a Git tag, and ready images are at `ghcr.io/danarkhipov/folkbranch`.

## Unreleased

## 1.4.0 - 2026-11-08

Sign in with Yandex ID, VK ID, Telegram, Google or a code by mail; assistant providers in Russia and China; load a tree together with its photos, by merging or replacing; a clearer chart with menus.

### Added
- The model list is read from the provider itself, newest first, with a mark for models that see pictures (OpenRouter, Anthropic and Moonshot say so). A model that cannot see is not offered the scan-reading tool, and the owner is told.
- Assistant providers in Russia and China: Yandex AI Studio, Cloud.ru (GigaChat, Qwen and others), DeepSeek and Moonshot (Kimi), chosen in the same list by region.
- Ways to sign in besides a link, each switched on by the owner under **Settings → Ways to sign in** with its steps, the return address and a check before saving: Yandex ID, VK ID (also Mail.ru and Odnoklassniki accounts), Telegram, Google, and a six-digit code by mail. Relatives link the ones they like under **My account** and add their own email there. Keys typed in the app are kept encrypted; server variables still win. See `docs/SIGN_IN.md`.
- Load a tree file in one of three ways: add to the family, merge with the people already there (the same person is found by name and dates and nothing is doubled), or replace everything. The dialog says beforehand how many people would be added, matched and linked.
- Load a tree together with its photos and files: drop them in one go, and each picture is attached to the people it belongs to, by the file's own links, by the person's id in its name, or by name.
- A right-click menu on the chart. On a person: open, add a parent, a spouse or a child, delete. On an empty place: add a person there, load a file, search, show everyone, flip the chart, delete the whole chart. A person added from the menu stands where it was pressed.
- An empty chart offers to load a tree file, beside the first person.
- Hovering a person lights their whole line outward, ancestors and descendants. A press on the chart closes open menus.
- A living person's dates read `1950 –`, open at the end, not as a finished life.
- While a new version is put in place, the page waits and reopens by itself instead of showing an error.

### Changed
- The chart's rows follow birth years, so relatives of one age stand level. Lines keep clear of each other and each branch keeps to one stretch of its row.
- The family overview, places, checks and search follow the part of the family chosen under **Who to show**, and say so.

### Fixed
- A GEDCOM event, source or page written over several lines is read whole.
- A long name on the chart is cut after three lines, so it cannot run into the lines and rows below.
- A small disk with room to spare is no longer reported as full.
- Cloud.ru models are read from its own list, with what each can do: tools, pictures and prices in roubles.

## 1.3.0 - 2026-11-08

The family's records: places, archives and the people at an event, a calendar of family days, a fan of ancestors, private people and stories, a printed page, and a safer sign-out.

### Security
- Signing out empties the browser's cache of photos and removes text never sent and face prints, so the next person at a shared computer finds nothing. It asks first when there is unsent text. Photos are no longer kept for a year without asking the server: a copy left by someone else's session opens only for those allowed to see it.
- Text kept in the browser while offline is offered back only to the account that typed it.

### Added
- A map of the family's places under **Dates, places and archives**, and each life's places in order under **Life in order**. The map comes from OpenStreetMap, so each device allows it once before the first picture is fetched; names and dates never go there.
- The assistant looks at photos and scans already in the archive, a picture or a PDF, and reads them, handwriting included, then proposes what they show with the document as the source.
- The assistant and agents add and change places: what a place was part of, its old names and its point on a map, each change waiting for review from a token.
- The assistant shows a person's ancestors, descendants or close family on the chart when asked.
- Places as records, under **Dates, places and archives**: what a place was part of, its old names and when they held, and where it is on a map. Search finds people by an old name too.
- Archives as records with an address and a site, chosen for each source. A source also keeps its record number, the date of the document and a transcription.
- People at an event, each with a role: godparent, witness, priest. Those with a card link to it, and readers see no one hidden.
- Fields of their own for military service (unit, rank), looks, a wound, captivity, an award and a membership. New kinds of fact: estate, title, languages.
- "No children" and "never married" on a person's family, so the check stops asking.
- Addresses and phones of living relatives, seen only by editors: never by readers, guests, agents, the file for relatives or GEDCOM.
- Keep a person who died, or a single story, from readers, guests and read-only agents, as the living are kept. GEDCOM carries the mark both ways.
- Ask for a story with up to five questions, from a ready list or your own. The relative picks one before each recording, and it names what they send.
- The server copies the database by itself each day and keeps the last seven. **Settings → Data and backups** says when it last did, and can copy now.
- Print a person, or keep them as a PDF: life in order, family, facts, biography, stories and sources.
- A calendar file of the family's days for a phone or computer, from **Dates and numbers**.
- Moving from Gramps and webtrees, checked on files written their way: baptism and other events, the surname from birth, periods of residence, godparents, private marks and the archive a source is kept in now come across. See `docs/MOVING.md`.
- **Dates and numbers** on the chart's toolbar: birthdays and anniversaries of the next two months, and the family in numbers.
- An **ancestor fan** for any person: the whole line in one picture, under **Who to show**.
- **Life in order** in a person's details: birth, marriage, children, facts and death, read from what is already written.
- A page of its own when there is no connection, and a page for a link that leads nowhere, in place of the browser's own.

### Changed
- On a phone, settings open as a list, one section at a time; the bottom bar no longer runs its labels together.
- A person's card: details come first, the bin and the history moved to a menu, and an empty field no longer offers a source.
- Clearer words in the settings: no MCP or "smart functions" in the names, the full copy comes first, and a failed action says so and stays until read.
- The first screen loads less: search and adding a relative come when first used.

### Fixed
- One fact changed on two devices at once: the second is now told, as for a single field, instead of one edit silently replacing the other. A fact one device changed is no longer removed by the other.

## 1.2.0 - 2026-11-07

Install on any computer without Docker, talk to the assistant, find familiar faces across all photos, and ask a relative for a story by a link.

### Security
- A restored copy can no longer point a file name outside the media folder.
- Readers no longer see the names of deleted people in the history.
- The assistant always asks before marking anyone as dead, since that shows them to readers.
- A sign-in on this computer refuses what arrived through a tunnel or proxy.

### Added
- `--server` installs on any Linux server in one command, with no Docker and no domain: HTTPS by itself, a service that starts with the server, and nothing reachable from the internet running as root.
- An installer for Windows, `install.ps1`, checked when a release is built. Not proven yet: Docker remains the sure way there.
- `./folkbranch share` gives an install on your own computer an address on the internet for a while, so a relative can open a link. It asks first, and `./folkbranch share stop` closes it.
- `npx folkbranch` installs the app on the first run and opens it after that.
- Ask a relative for a story by a link: they open it on a phone, press one big button and talk, with no account and without seeing the archive. The recording waits for your review.
- Bring in a research case from the ex-ussr-kinship-research skill: pick its folder under **Settings → Files**, or an agent uses `import_kinship_case`. Candidates stay separate cards, unproved relations stay notes off the chart, and every status and source stays with what it describes. Bringing in the same case again only adds what is new to its cards.
- A plugin for Claude Code: `/plugin marketplace add danarkhipov/folkbranch`, then `/plugin install folkbranch@folkbranch`.
- `./folkbranch open` opens the app in the browser, signed in, and starts it if it was stopped. The first install without Docker opens the browser by itself.
- A file for relatives: one button under **Settings → Users and access** makes a single HTML file with the chart, cards and photos. It opens with no server, account or internet, and the living stay hidden.
- **Smart features**, switched on separately on each device under **Settings → Smart features**, and off by default apart from finding faces: suggesting who is in a photo from faces already tagged, and turning a recorded story into text in the browser. Photos and voice stay on the device; only the models are downloaded.
- Under **Check → Faces**: look through all photos for familiar faces, and set portraits for people who have none.
- Speak to the assistant instead of typing, with the words recognised on the device.
- Models download only when you press the button, in the settings or where a feature needs them, and can be removed again.
- Choose between models under **Settings → Smart features**: light, accurate or maximum for finding faces, and GigaAM or Whisper for speech.
- Faces are found with YuNet and compared with SFace, which handle old group photos far better than the earlier models. Finding and comparing runs away from the page.
- Install without Docker, on macOS and Linux. One command picks the lightest way: 23 MB if the computer has Node 24, about 48 MB with Node inside the folder. `--docker` and `--domain` still use Docker.
- `./folkbranch start`, `stop`, `restart`, `status` and `logs` for an install without Docker. It restarts itself after a crash and a restore.
- Hide all the panels: the bar narrows to a square around its logo, with its edge showing behind.
- The chart works from the keyboard: arrows through the family, + − 0 to zoom, a skip link, the list of keys under How to read the chart, and focus that returns when a panel closes. Screen readers hear the relation on each card.
- A History tab in each person's card: who changed what and when, what it was before, and a button to roll it back. The card says so when someone else changed it lately.
- Search looks through everything written about a person: dates in any form, places, facts, sources, biographies, stories and photo captions. It takes other word forms, nicknames, Latin letters, the wrong keyboard, typos and questions like "Ivan's wife", shows what it found in the results, and marks it in the card.

### Changed
- Settings are grouped and each screen says what it is for. View links have their own screen, the first screen links to the others instead of repeating their forms.
- One kit for the whole interface in `components/ui`: a styled dropdown instead of the browser's, one text field, copy buttons, switches. A test stops new copies.
- Every button with a `title` shows a designed hint, and the main ones say what they do.
- The history says who changed what, with the old and new value, and has a visible Roll back button on each entry.
- Review is its own panel: edits to approve, cards to fill in and similar people. The history shows only history.
- The AI assistant comes first in the top bar, with a clearer icon.
- Who to show on the chart: choose the person right in the menu, with one line on what each choice means.
- A key's name is no longer cut to one letter. Revoking a key asks first, and a new key lasts a year unless you choose otherwise.

### Removed
- The Relationship panel in the top bar.

### Fixed
- The install command run through `curl | sh` stopped before printing the setup link.

## 1.1.0 - 2026-11-06

### Added
- A logo in the app, a favicon, icons for phones and for installing the app, and a web app manifest.
- Language by browser on the first screen, with a choice there and under **Settings → Archive**.
- An English demo family, so a new English archive starts with English names and text.
- Tests that catch any interface word without an English translation.

### Changed
- **Folkbranch is the project's name.** The repository, image, install folder, agent name, key variable (`FOLKBRANCH_TOKEN`) and command (`./folkbranch`) all use it.
- English is the main language, of the interface and of the documentation.
- New tokens start with `fb_`. Tokens already issued keep working.
- Clearer wording across the English interface.
- Container actions and pinned workflows are up to date. Node stays on its long-term release.

### Fixed
- The top bar folds up in a narrow window when no card is open, instead of running off the edge.
- The button that revokes an agent's token now says Revoke, not Undo.
- On a read-only card, a label stays beside its value when the next cell is empty.
- The assistant shows the server's own words in English too, such as when its daily limit is used up.

## 1.0.0 - 2026-11-05

First public release.

### Added
- A first-run guide that says what is set up and what is missing, with logos of the services it connects to.
- Install in one command from a ready image, and one command to connect Claude Code or Codex over MCP.
- A skill any agent can follow to install the app on a computer or a server.

## 0.9.0 - 2026-11-05

### Added
- Merge two cards of one person: every value survives as a version, and one undo restores both.
- A copy of the database before every migration.

### Fixed
- The person's card holds up under long names, huge families and no data at all.

## 0.8.0 - 2026-11-05

### Added
- Stories with a voice, recorded in the browser or from a file, kept apart from facts.
- Readers can suggest corrections for review.
- A link that lets anyone view the family without an account.

## 0.7.0 - 2026-11-05

### Added
- Print the chart to PDF on one sheet or across several.
- Show ancestors, descendants or closest family, fold branches, save views, and place cards by hand.

## 0.6.0 - 2026-11-05

### Added
- Download the whole archive as one checked file, and restore it on a clean install.
- A list of what is left to check, and people marked on photos without a card.

## 0.5.0 - 2026-11-05

### Added
- Several people and agents can work at once without losing each other's edits.

### Changed
- A chart layout that crosses fewer lines and draws only what is in view, with one readable type scale.

## 0.4.0 - 2026-11-04

### Added
- A built-in AI assistant on your own key, from several providers, with the same permissions as the person using it.
- Protection against prompt injection, and a checked tool for every action.

## 0.3.0 - 2026-11-04

### Added
- One-command install with Docker and automatic HTTPS, a protected first setup, and expiring tokens.

## 0.2.0 - 2026-11-04

### Added
- Versions of a date, place or name, each with its source and status.
- Structured sources, and import from Excel, CSV, JSON and plain text.

## 0.1.0 - 2026-11-04

### Added
- The family chart, and a page with photos for every relative.
- GEDCOM, MCP and tokens with changes reviewed by a person, and full history with undo.

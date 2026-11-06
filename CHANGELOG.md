# Changelog

All notable changes are listed here, newest first. Versions follow [Semantic Versioning](https://semver.org). Each version is a Git tag, and ready images are at `ghcr.io/danarkhipov/folkbranch`.

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

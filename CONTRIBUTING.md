# Contributing

Thanks for helping. Bugs, ideas and pull requests are all welcome. For a larger change, please open an issue first, so we can agree on the approach.

## Run it

You need Node 24 and [pnpm](https://pnpm.io) 9: `corepack enable` gives you the version `package.json` names.

```bash
pnpm install
pnpm dev
```

The app opens on http://localhost:3417 with its data in `./data`, which Git ignores. Tick "Load the demo family" on the first screen to get an invented family to work with.

If a page keeps reloading by itself in `pnpm dev`, the development cache is stale. Stop the server, run `rm -rf .next/dev` and start it again. Your data is not in there.

In `pnpm dev` you are signed in as the owner by yourself, on this computer only, so signing out brings you straight back. To try another role, open an invitation link. A build does this only with `FOLKBRANCH_LOCAL_LOGIN=1` and a `localhost` address; never set it on a server.

## Check it

| Command | What it runs |
|---|---|
| `pnpm lint` | Type checks and ESLint (the Next.js rules for React, hooks, accessibility and TypeScript) |
| `pnpm test` | Unit and integration tests |
| `pnpm audit --audit-level high` | Fails on a dependency with a known high or critical vulnerability |
| `pnpm check` | All of the above, plus a check for import cycles. Run it before you open a pull request |
| `pnpm check:full` | Everything in throwaway Docker containers and folders: browser scenarios, install without Docker, speed budgets, crash and restore scenarios. No paid model is called |
| `pnpm check:ui` | Browser checks on a plain production build with an invented demo family, no Docker: layout at phone and laptop widths, the map's layers panel, and the map scenario. Run `pnpm build` first. Screenshots go to `./ui-shots` |
| `pnpm check:perf` | Speed budgets on 2,000 invented people and 300 towns: map reload and first zoom, faces shown, time the page is busy. Not part of pull request gating; it runs weekly and on demand |
| `node tests/e2e/data-survives.mjs` | After `pnpm build && node scripts/make-bundle.mjs`: the last release fills an archive, this version opens it, restarts and crashes, and nothing entered may be lost or changed |
| `node tests/e2e/concurrent-people.mjs`, `concurrent-live.mjs`, `concurrent-agents.mjs` | After the same build: three people writing at once, a person with the assistant and an outside agent over MCP, drafts accepted after the card changed, conflicts, deletes against edits, live updates, and the server killed in the middle of writing. Nothing confirmed may be lost |

ESLint findings that were there before it was switched on are listed in `eslint-suppressions.json`, so only new ones fail. When you fix old ones, run `pnpm exec eslint . --prune-suppressions` to shrink the list.

CI runs all of this on every pull request: lint, tests, the vulnerability audit, a review of added dependencies and their licences, CodeQL code scanning, the install without Docker, the update from the last release on the same data, and the Docker image with a scan for critical vulnerabilities.

Turn on the repository's Git hooks once after cloning: `git config core.hooksPath .githooks`. They refuse a commit that names an AI assistant as author or co-author, which CI also checks: you may use any tool, but the commit is yours.

## Check it like a user before you open a pull request

`pnpm check` does not see what a person sees. For a change people can see, also use it yourself in a browser before you open the pull request:

1. **Walk the whole flow you touched**, at a laptop width and at a phone width (375 and 390 px, with touch). Try empty, normal and very large data. Sign in as each role the change affects: owner, editor and reader. Keep before and after screenshots, for laptop and phone.
2. **Check speed on a large family.** Reload the screen you changed and use it at once. Run `pnpm check:perf`, or import a 2,000-person family made with `python3 tests/ui/gen-placed-family.py 2000` (create the towns first, as `tests/ui/serve.mjs` does). In the DevTools Performance panel with CPU throttled 4x, no task over 200 ms may run while the user waits. Do not build anything before the data has arrived, and do not do work for every person that could be done once.
3. **Check the phone layout.** Bars show icons only, and every icon has an accessible name. Controls are at least 44 px (the automated check allows 40 px). Nothing is wider than the screen, nothing lies over anything else, and every control can be reached from the keyboard.
4. **Check four languages.** Wrap every new user-visible word in `t()`, with the Russian phrase as the key. Add the English to `lib/i18n.ts`, the Spanish to `lib/i18n-es.ts` and the Catalan to `lib/i18n-ca.ts`. The tests fail without all of them. Use the project's terms: árbol / arbre for tree, ficha / fitxa for a person's card, hecho / fet for a dated life event on the map, familiar for relative, archivo / arxiu for archive. Use informal tú / tu, never usted or vós. Catalan must be real Catalan. Keep `{placeholders}` and «quotes» as they are.
5. **Check privacy.** Readers and reader tokens must never receive a living person. A hidden person's dates, places and marriages stay hidden. New read tools go into the reader sweep in `tests/api.test.ts`.
6. **Write a test that fails without your fix**: a unit test in `tests/`, or a browser test in `tests/ui/`. Check that it fails without the fix, and say in the pull request how you checked.
7. **Add a changelog line** under **Unreleased** in `CHANGELOG.md`, written for people who use the app. If a promise changed, update `README.md` and the matching page in `docs/` too.
8. **Keep real family data out of everything**: code, tests, screenshots and issues.

Bug classes found in the map work are worth checking by eye:

- a hidden or folded element catches clicks meant for the one on top;
- a screen is slow only in the first seconds after a reload;
- a text label does not fit a phone;
- an English word appears on a Spanish or Catalan screen;
- a link to a deleted record silently points at a namesake;
- a reader sees a hidden person's marriage;
- edits waiting for the server are lost when the tab closes.

Coding agents and automation: [docs/FOR_AGENTS.md](docs/FOR_AGENTS.md) is the same list as a loop to run before saying "done". The testing guide is [docs/TESTING.md](docs/TESTING.md). CI repeats the automated parts of this list on every pull request. The browser checks upload their screenshots as the `ui-screenshots` artifact, which is kept for 14 days. A pull request that changes a screen without phone screenshots will be asked for them.

## How the code is organised

- All changes to data go through one path, `lib/ops/`. The app, REST and MCP share it, so a new operation belongs in `lib/ops/registry.ts`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- Anything a reader can get must hide living people. Add new read tools to the reader sweep in `tests/api.test.ts`.
- A schema change: edit `lib/db/schema.ts`, run `pnpm exec drizzle-kit generate`, commit the migration. Migrations only add: never drop or rename a column or table people's data is in, since an update must open every older archive. `tests/migrations-order.test.ts` and the update check in CI guard this.
- A new word in the interface: wrap it in `t()` and add its English to `lib/i18n.ts`, its Spanish to `lib/i18n-es.ts` and its Catalan to `lib/i18n-ca.ts`. `tests/i18n-coverage.test.ts` and `tests/i18n-tables.test.ts` fail without them.
- Use the project's terms in Spanish and Catalan (árbol / arbre for the tree, ficha / fitxa for a card, hecho / fet for an event on the map) and speak to the reader as tú / tu. Run `pnpm exec vitest run tests/i18n-tables.test.ts` to see what is missing.
- A changed logo: edit the sources in `docs/brand`, then run `node scripts/make-icons.mjs`.

## Pull requests

- `main` is what is released, and work goes to `develop`. Please aim pull requests at `develop`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:`, `test:`.
- Note anything people will notice in `CHANGELOG.md`, under **Unreleased**. How a version is chosen and a release is cut is in [docs/RELEASING.md](docs/RELEASING.md).
- **Never commit real family data.** Tests and the demo use invented people only. Please do not attach real names or photos to issues either.

By contributing you agree that your work is licensed under [AGPL-3.0](LICENSE).

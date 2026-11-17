# Instructions for coding agents and automation

Point your agent at this file (some tools read `AGENTS.md` at the repository root, which Git ignores here because `next dev` writes its own there).

This file is for coding agents and automation working in this repository. Humans should follow it too. The full guides are [CONTRIBUTING.md](../CONTRIBUTING.md), [TESTING.md](TESTING.md) and [RELEASING.md](RELEASING.md).

## Where things are

- `lib/ops/`: every change to data. New operations go in `lib/ops/registry.ts`.
- `lib/db/schema.ts`: database schema. Generate migrations with drizzle-kit and commit them.
- `lib/i18n.ts`, `lib/i18n-es.ts`, `lib/i18n-ca.ts`: English, Spanish and Catalan strings.
- `tests/`: unit and integration tests (Vitest). `tests/ui/` and `tests/e2e/`: browser checks.
- `scripts/ui-check.mjs`: runs the browser checks.
- `CHANGELOG.md`: add user-visible changes under **Unreleased**.
- `eslint-suppressions.json`: old lint findings. Only new findings fail.
- `docs/brand`: logo sources.

## Rules

- Use English only in code comments and docs. A test enforces this.
- Never commit real family data: no real names, photos, databases, archives or GEDCOM files, in code, tests, screenshots or issues. Use invented people only.
- Commits and pull requests never name an AI assistant as author or co-author. Run `git config core.hooksPath .githooks` once after cloning. CI job `authorship` checks this too.
- Never push, tag, publish, release, merge to `main` or deploy without the maintainer's explicit yes for that step. Keep work local until then.
- Aim pull requests at `develop`. The PR title becomes the squash commit, in Conventional Commits form (`feat:`, `fix:`, `docs:`, `test:`).
- Readers must never receive living people. A new read tool goes into the reader sweep in `tests/api.test.ts`.
- Migrations only add. Never drop or rename a column or table that holds people's data.

## Verification before you say "done"

Run these in order and fix what fails.

1. `pnpm build`
2. `pnpm check`
3. `pnpm check:ui`. Screenshots go to `./ui-shots`.
4. Open `./ui-shots` and look at every screen you changed at phone size (375x812 or 390x844) and at laptop size (1440x900).
5. If you touched the map or a large list, run `pnpm check:perf` (budgets in `tests/budgets.json`). Work must not run for every person when it can run once, and no task may block the user for more than 200 ms.
6. If you added a user-visible word:
   - wrap it in `t()`, with the Russian source phrase as the key;
   - add the English to `lib/i18n.ts`, the Spanish to `lib/i18n-es.ts` and the Catalan to `lib/i18n-ca.ts`;
   - keep `{placeholders}` and «quotes»; use informal "tú" / "tu", never usted or vós;
   - use the project terms, for example árbol / arbre for tree, ficha / fitxa for a person's card, familiar for relative, archivo / arxiu for archive.
7. For a bug fix, add a test that fails without the fix. Confirm it fails for the reason the bug describes.
8. If the change is visible to users, add a line under **Unreleased** in `CHANGELOG.md`, written for people who use the app.

## Final report

Say what you ran and what it showed. List each command with its result. Say what you did not run and why, for example "no Docker on this machine, so `pnpm check:full` was not run". Name the screenshots you looked at. Do not report a check as passed if it did not run.

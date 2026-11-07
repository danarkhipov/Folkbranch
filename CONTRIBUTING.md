# Contributing

Thanks for helping. Bugs, ideas and pull requests are all welcome. For a larger change, please open an issue first, so we can agree on the approach.

## Run it

You need Node 24 and [pnpm](https://pnpm.io).

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
| `pnpm lint` | Type checks |
| `pnpm test` | Unit and integration tests |
| `pnpm check` | Both, plus a check for import cycles |
| `pnpm check:full` | Everything in throwaway Docker containers and folders: browser scenarios, install without Docker, speed budgets, crash and restore scenarios. No paid model is called |

CI runs the first two and builds the image on every pull request.

## How the code is organised

- All changes to data go through one path, `lib/ops/`. The app, REST and MCP share it, so a new operation belongs in `lib/ops/registry.ts`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- Anything a reader can get must hide living people. Add new read tools to the reader sweep in `tests/api.test.ts`.
- A schema change: edit `lib/db/schema.ts`, run `pnpm exec drizzle-kit generate`, commit the migration.
- A new word in the interface: wrap it in `t()` and add its English to `lib/i18n.ts`. `tests/i18n-coverage.test.ts` fails without it.
- A changed logo: edit the sources in `docs/brand`, then run `node scripts/make-icons.mjs`.

## Pull requests

- `main` is what is released, and work goes to `develop`. Please aim pull requests at `develop`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:`, `test:`.
- Note anything people will notice in `CHANGELOG.md`, under the next version.
- **Never commit real family data.** Tests and the demo use invented people only. Please do not attach real names or photos to issues either.

By contributing you agree that your work is licensed under [AGPL-3.0](LICENSE).

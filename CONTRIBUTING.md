# Contributing

```bash
pnpm install && pnpm dev
```

Before sending a change, run `pnpm lint` and `pnpm test`. CI runs the same and builds the Docker image.

- All changes to data go through one path, `lib/ops/`. The app, REST and MCP share it, so a new operation belongs in `lib/ops/registry.ts`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- Anything a reader can get must hide living people. Add new read tools to the reader sweep in `tests/api.test.ts`.
- A schema change: edit `lib/db/schema.ts`, run `pnpm exec drizzle-kit generate`, commit the migration.
- **Never commit real family data.** Tests and the demo use invented people only. Do not attach real names or photos to issues either.

By contributing you agree that your work is licensed under [AGPL-3.0](LICENSE).

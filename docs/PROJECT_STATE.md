# Project state and decisions (27 Nov 2026)

A hand-over of what was decided and built in the Claude Code chat of 17–27 Nov, so a coordinator can continue without that chat. It records the owner's decisions as he gave them, what is done, what is waiting, and what has not been verified. It holds no data about real families and no secrets.

## Standing rules from the owner

- **Money.** Nothing is spent without a separate "yes" for that exact run: name the model, the price per million tokens, the expected total and the cheaper option first. Pointing at a key is access, not permission.
- **Accounts and keys.** The owner creates accounts and keys (OpenRouter, Turnstile, Cloudflare, Railway). Agents never create them and never print values.
- **Publishing.** Push, merge, deploy and publication only on the owner's explicit word. Releases and live-data fixes stay local until he asks.
- **Commits and PRs.** Author is the owner; no AI attribution and no `Co-Authored-By` lines; PR text is technical only.
- **Versions.** The next release is 1.9.0 (minor). 2.0.0 is not used. Every release also redeploys the public demo.
- **Branches.** `main` and `develop` are protected by rulesets: changes only through a pull request (squash or rebase into `develop`, merge or rebase into `main`), one code-owner approval, eleven required checks. A release is a PR `develop → main`, then the tag.
- **Real data.** The repository holds no real family data. `family.danarkhipov.com` does; never copy it into the repo or tests.
- **Cheap executors.** Simple steps go to cheap sub-agents (Haiku). For DeepSeek and OpenCode models never set `max_tokens` (replies come back empty).

## Done

- **1.8.0** released and deployed on 19 Nov; eight live data fixes applied, backups on the volume.
- **Release notes** are built by `scripts/release-notes.mjs` from `CHANGELOG.md` (opening, Highlights, Upgrading, groups, PRs, contributors, compare link).
- **Repository protection** and settings per `docs/MAINTAINING.md`; social preview uploaded.
- **Landing** now lives in `landing/` (nginx), kept in step by `tests/landing.test.ts`; SEO pass done.
- **Landing v2** (PR #23, 12/12 checks): calm light style, real screenshots, phone layout fixed. Its main button points at `demo.folkbranch.com`, so it must not go live before the demo does.
- **Demo mode** (PR #24, `FOLKBRANCH_DEMO=1`, see `docs/DEMO.md`): a pool of app copies, one per visitor, behind `demo/router.mjs`; 60-minute lifetime, 20-minute idle; AI limited to 20 messages per copy, daily token caps per copy and in total, upload, storage, database and people caps; one live copy and three starts per hour per address; Turnstile required on https. Two independent reviews found 16 defects, all fixed with tests that fail without the fix. Full test run 1622 passed, browser e2e passed, Docker run passed.

## Waiting for the owner's "yes"

1. Merge PR #23 and #24 into `develop`, then PR `develop → main`, tag 1.9.0.
2. A small paid model run (Claude Haiku 5.5 via OpenRouter, USD 0.10 in / 0.50 out per million tokens, under USD 1) on the demo scenarios.
3. The owner creates an OpenRouter key with a monthly cap (suggested USD 20).
4. A Railway service `demo` in project `folkbranch`: about USD 10–13 a month for eight copies plus a small volume for `DEMO_STATE_DIR`.
5. Cloudflare (owner's account): DNS for `demo.folkbranch.com`, a Turnstile site, a Transform Rule that adds `x-demo-cf`, and disabling the `*.up.railway.app` address.
6. Only after the demo works: publish landing v2.

## Not verified

- Haiku 5.5 answer quality on the demo scenarios.
- Real Turnstile and Cloudflare behaviour; the demo was only run in Docker locally.
- `demo/router.mjs` use of `DEMO_STATE_DIR` has no separate test.
- `install.ps1` on real Windows.
- Russian texts by a native speaker.
- CI of PR #24 was still running at the time of writing.

## Later

- A real installer or a hosted version for less technical relatives.
- Roadmap items still open: family book, static copy of the site for relatives, voice transcription.
- Cleanup: temporary demo server on port 3650, old worktrees, extra Docker tags and containers.

# Releasing

How a change reaches people, and who does what. It follows what well-run open source projects do: [Semantic Versioning](https://semver.org), [Keep a Changelog](https://keepachangelog.com), [Conventional Commits](https://www.conventionalcommits.org), and one tag that starts everything else.

## Three different things

| | What it is | Needs a version and notes? |
|---|---|---|
| **Merge** | Work lands on `develop` | No. A line under **Unreleased** in `CHANGELOG.md` if people will notice it |
| **Deploy** | A running server gets the code, for example a Railway service | No. It is not a release: no tag, no version bump |
| **Release** | A version people can install: tag, images, release notes, npm | Yes, always all of it |

A deploy never changes the version, and nothing is released by accident: only a pushed `v*` tag releases.

## Every change

- Branch from `develop`, pull request into `develop`, squash-merge. The PR title is the commit message: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, and `!` after the type (or `BREAKING CHANGE:` in the body) for a break.
- Anything a person using the app would notice goes under **Unreleased** in `CHANGELOG.md`, in the same pull request, written for them and not for developers: what they can do now, not which file changed. Groups: Added, Changed, Fixed, Removed, Security. Security goes first.
- A change to what the app promises (a feature, a way to sign in, a supported provider) also changes `README.md` and `README.ru.md` in the same pull request, and the matching page in `docs/`.
- Run `pnpm check` before opening it. A screen needs a browser test in `tests/e2e`.
- No real family data in code, tests, screenshots or issues.

## Choosing the number

- **Major**: something an owner must act on when upgrading, or that breaks what others build on: a database migration that cannot run by itself, a renamed or removed environment variable, a changed or removed MCP tool or API field, a changed token scope, a file format we write (GEDCOM, backup) that older readers cannot open.
- **Minor**: a new feature or provider, an additive migration, an additive tool or field, a deprecation.
- **Patch**: a fix, a faster or smoother screen, wording, docs, a dependency update with no visible effect.
- A version that was released is never changed or reused. A broken release is followed by a new patch, and its notes say which version it replaces.

## Cutting a release

Done by the maintainer, from a clean `main`. Agents prepare the commit and stop: they never merge to `main`, tag, push or publish without a clear yes for that step.

1. `develop` is green: `pnpm check`, the browser tests, and a check by hand of what is new.
2. In `CHANGELOG.md` rename **Unreleased** to `## X.Y.Z - YYYY-MM-DD` and put a new empty **Unreleased** above it. Read the section once as a user: is anything missing, is anything internal?
3. Set `version` to `X.Y.Z` in `package.json` and `npm/package.json`. `tests/release.test.ts` fails when they differ or the changelog has no section for that version.
4. Commit `chore(release): X.Y.Z`, merge `develop` into `main`.
5. Tag `vX.Y.Z` on that commit and push the tag. `.github/workflows/release.yml` then builds the images (`ghcr.io/danarkhipov/folkbranch`, `X.Y.Z`, `X.Y` and `latest`) and the bundles for each platform, and publishes the GitHub release with the changelog section as its notes. Never write the notes by hand in GitHub: edit `CHANGELOG.md` and run the workflow again.
6. Check the release page, that the image starts, and that `install.sh` fetches the new version.
7. Publish the `npm` package, if its content changed. Only the maintainer's login does this.
8. Update the repository description and topics only when what the product is in one sentence has changed.

## Hotfix

Branch from the tag, fix, then the same steps with a patch number, and merge the fix back into `develop`. A security fix gets its own entry under **Security**, and the release title ends with `[SECURITY]`.

## What never leaves this computer without a yes

`archive/private-*` branches and `refs/archive/*`, real family data, any push, tag, release, npm publish or deploy. A standing yes for one of them is not a yes for the next.

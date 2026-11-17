# Testing

This page lists the checks in Folkbranch, what each one catches, and how to run them.

Before you open a pull request, run `pnpm check`. If you touched a screen, also run `pnpm build` and `pnpm check:ui`.

## Layers

| Layer | Tool | Where | What it checks |
|---|---|---|
| Types and lint | TypeScript, ESLint | `pnpm check` | Types, React, hooks and accessibility rules |
| Unit and integration | Vitest | `tests/*.test.ts` | Operations in `lib/ops/`, the API, migrations, translations |
| Browser checks | Playwright with Chrome | `tests/ui/`, `tests/e2e/map.mjs` | Layout at phone and laptop sizes, the map, the layers panel |
| Speed budgets | Playwright with Chrome | `tests/ui/map-reload.mjs`, `tests/budgets.json` | Map reload and zoom on a large family |
| Docker scenarios | Docker | `pnpm check:full` | All of the above in throwaway containers, plus install, crash and restore |

The browser checks run on a plain production build with an invented demo family. They do not need Docker.

## Commands

| Command | What it catches | When it runs |
|---|---|---|
| `pnpm check` | Type and lint errors, failing unit and integration tests, a dependency with a known high or critical vulnerability, import cycles | On the laptop before every PR. CI job `test` on every PR |
| `pnpm check:ui` | Layout overflow, overlap, unnamed buttons, phone rules; layers panel behaviour; map scenario | On the laptop after `pnpm build`. CI job `ui` on every PR |
| `pnpm check:perf` | Slow map reload, slow first zoom, long busy periods on a large family | Weekly (workflow "Speed") and on demand. Not a PR gate, because it is noisy on shared machines |
| `pnpm check:full` | Everything above in Docker, plus install without Docker, crash and restore | On demand on the laptop. Needs Docker |

Speed runs are noisy on shared machines. That is why they run weekly and not on every PR.

## Running one check

The browser checks use the `.next` folder. An old build gives old results, so build first:

```bash
pnpm build
pnpm check:ui
```

Run only some browser checks. The filter matches part of the file name:

```bash
node scripts/ui-check.mjs layout
```

If `.next` is missing, `pnpm check:ui` builds it for you. Use `--no-build` to skip that automatic build.

Screenshots of every state go to `./ui-shots`. To put them somewhere else, set `UI_SHOTS`:

```bash
UI_SHOTS=./my-shots pnpm check:ui
```

## What each browser check guards

| Check | Screens and sizes | What it asserts | Mistakes it guards against |
|---|---|---|
| `tests/ui/layout.mjs` | Tree, map, map-layers panel at 375x812, 390x844, 768x1024 and 1440x900 | Nothing is wider than the screen. Bars and panels are inside the screen and do not overlap. Every bar button has an accessible name. On a phone: icons only, no text labels, buttons at least 40 px (review target: 44 px), bottom bar at most 60 px high | Horizontal scrolling on a phone; a panel covering another control; icon buttons a screen reader cannot name; text labels that do not fit a phone; small touch targets; a bottom bar that takes too much height |
| `tests/ui/map-layers.mjs` | The map's layers panel | People, Events, Routes and "All past moves" switches work. Each kind box works (Births, Marriages and unions, Moves and places of residence, Work, service, study, Deaths, Other). Reset works. A dot shows on the button when a filter is set. The choice survives a reload. The last kind cannot be unchecked. Spanish and Catalan show no Russian or English leftovers | Filters that do not apply; a choice lost on reload; an empty map caused by unchecking everything; untranslated words in Spanish and Catalan |
| `tests/e2e/map.mjs` | The original map scenario | Year slider, play, stacks and place cards, a person's route, line of descent. A reader sees no living relatives. The page asks nothing of another server | Living people shown to readers; broken map controls; a page calling out to another server |
| `tests/ui/map-reload.mjs` (`pnpm check:perf`) | Map on 2,000 invented people and 300 towns | Faces shown within 3 s on a laptop and 7 s on a phone (4x slower processor). First zoom answers within 1.5 s and 3.5 s. Long tasks at most 2 s and 6 s | A map that is slow in the first seconds after a reload; work done for every person that could be done once |

At the time of writing, the speed numbers are a fifth to a half of the budgets.

## Adding a UI check

1. Create a file in `tests/ui/`. Its name is what the filter in `scripts/ui-check.mjs` matches.
2. Import the helpers from `./lib.mjs`:
   - `ok` records a passing assertion.
   - `open` opens a signed-in browser at a size. The phone size uses touch input and 3x density.
   - `openMap` opens the map.
   - `shot` saves a screenshot of the current state.
   - `finish` ends the check.
   - `SIZES` lists the standard sizes.
3. Assert geometry and behaviour: sizes, overlap, what is inside the screen, what a click does, what survives a reload. Do not compare pixels.
4. Save a `shot` for each state you want a person to look at.
5. Add the file to the `checks` list in `scripts/ui-check.mjs`.
6. Run `pnpm build`, then `node scripts/ui-check.mjs <part of the file name>`.

`tests/ui/serve.mjs` starts the built app on a throwaway data folder. It takes `SETUP_TOKEN`, loads the demo family, and accepts an optional `people` count for a bigger family.

## Reading a CI failure

1. Open the pull request's checks and find the failed job. A failure in the browser checks is in job `ui`. A failure in types, lint, unit tests or the audit is in job `test`.
2. In the `ui` job, find which check failed: `layout`, `map-layers` or `map`.
3. Download the `ui-screenshots` artifact from the run. GitHub keeps it for 14 days, so download it soon after the failure.
4. Open the screenshot of the failing state at phone and laptop size.
5. Reproduce on your computer: `pnpm build`, then `node scripts/ui-check.mjs <check name>`.
6. If the screenshot shows a real problem, fix the code. If the check itself is wrong, change the check and say why in the pull request.

## A bug fix comes with a test that fails without the fix

Every bug fix needs a test that fails on the old code and passes on the new code.

- Put a unit test in `tests/`. Put a browser check in `tests/ui/`.
- In the pull request, say how you checked that the test fails without the fix. For example: revert the fix on your computer, run the test, see it fail for the reason the bug describes, then restore the fix.

The same rule applies to a changed check. A test that passes with the bug present does not guard anything.

## Why screenshots are kept but pixel comparison is not used

- Screenshots are saved for every state and kept in CI for 14 days, so a person can look at the page.
- Pixel comparison is not used. Small rendering differences between machines make a pixel check fail for reasons that are not bugs. It is noisy.
- Instead, the checks assert geometry (sizes, overlap, inside the screen) and behaviour (clicks, state, reload). These fail for the mistakes that matter and not for rendering noise.

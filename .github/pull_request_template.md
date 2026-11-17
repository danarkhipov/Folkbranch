## What and why

<!-- What changes, and why. Say what people will notice. -->

## How it was checked

<!-- Commands and results. For a screen: the browser checks. For a fix: the test that fails without it, and how you saw it fail. -->

## Screenshots (laptop / phone)

| | Before | After |
|---|---|---|
| Laptop | <!-- image --> | <!-- image --> |
| Phone (390 px) | <!-- image --> | <!-- image --> |

## Speed

<!-- For a screen with many items: reload and use it at once on a large family (2,000 people), CPU throttled 4x. Longest task while the user waits: ___ ms. Otherwise write "not applicable". -->

## Checklist

- [ ] Based on `develop`
- [ ] `pnpm check` passes
- [ ] For a change to a screen: `pnpm build`, then `pnpm check:ui` passes
- [ ] For a visible change: laptop and phone screenshots, before and after, above
- [ ] For a screen with many items: speed checked on a large family, above
- [ ] Four languages: every new user-visible word is in `t()` (Russian key) with English, Spanish and Catalan added
- [ ] Privacy: readers and reader tokens get no living people; hidden people's data stays hidden
- [ ] A test that fails without the fix (unit in `tests/`, browser in `tests/ui/`); I checked it fails without the fix
- [ ] A line under **Unreleased** in `CHANGELOG.md`, written for people who use the app (or not needed, and why)
- [ ] No real family data in code, tests, screenshots or issues

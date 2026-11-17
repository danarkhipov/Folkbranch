# Architecture

The principle: as simple and cheap as possible. One container, one data folder, no required outside services.

## Overview

```
Docker container (Next.js: app + API + MCP)
└─ /data  (persistent disk: a Railway volume or a folder on a server)
   ├─ family.db   SQLite: people, links, pages, photo tags, users
   └─ media/      original photos and smaller copies
```

Backing up and moving means copying one folder.

## Stack

| Job | Choice | Why |
|---|---|---|
| App | Next.js (App Router), TypeScript | The interface and API in one service |
| Interface | Tailwind, shadcn/ui | Clean components, Cmd+K |
| Chart | `@dagrejs/dagre` + our own rendering (HTML cards, SVG lines, `d3-zoom`) | The whole family at once: `dagre` decides generations and the first order, and we compute positions and right-angled lines. Coordinates are not stored. See "Why not family-chart" |
| Pages | BlockNote (core only) | A block editor on top of Tiptap |
| Sign-in | Better Auth | Invitations, Google, Yandex ID, roles; its tables live in the same SQLite |
| Database | SQLite in WAL mode, Drizzle ORM | No separate server; search through FTS5 |
| Photos | `sharp` on the server, `react-easy-crop` for avatars, MediaPipe in the browser for faces, `yet-another-react-lightbox` | Smaller copies, cropping, face hints, viewing |
| Browser data | TanStack Query | Edits show at once, refresh on returning to the tab |
| AI | the official MCP TypeScript SDK | The built-in MCP server |

Check the license of any new dependency first. BlockNote's extra packages (AI, PDF and Word export) are under GPL or a paid license: do not use them.

## Why it is built this way

- **SQLite, not Postgres.** A family has few users and little data. WAL mode easily handles several people editing at once. One file makes backups and open-source installs simple.
- **Photos next to the database, not inside.** Inside SQLite the database quickly grows to gigabytes and backups get heavy. The database stores only a path.
- **No separate graph database.** The graph is link tables, and kinship is computed by walking them in code.
- **No real-time text merging.** Edits rarely overlap; conflicts are caught field by field, and everything is in history.
- **No Supabase.** A free project sleeps after a week without visits, the paid plan costs $25 a month, and it adds a second provider and RLS rules.
- **No React Flow or elkjs.** A free canvas would force us to store coordinates, and elkjs is under EPL.
- **Why not family-chart.** A prototype on 4 November 2026 showed that the library builds a view around one person only. From one person in the demo family it showed 13 of 27 people: no uncles, aunts or cousins. So "show everyone" and highlighting cousins were impossible. `dagre` shows the same 27 people at once and lays out 1000 people in 87 ms.

## The operations layer

All writes are described once in `lib/ops/registry.ts`: input, review text, how to apply. The app, REST and MCP call `dispatch()`. For a token a write goes to a draft, for a person it applies at once. A new write route is closed to tokens by default.

## Data model

```
persons       name, maiden name, sex, birth and death (date as text + year for sorting),
              places, living, avatar_media_id, certainty
parent_child  parent → child; kind: birth / adopted / step; assumed or not
unions        spouses; kind: marriage / civil; start and end dates
pages         person_id, parent_page_id, title, icon, order, content (BlockNote JSON)
media         file, size, caption, date, place, who uploaded
media_tags    photo ↔ person + frame (x, y, w, h as fractions)
history       who, when, what changed (before/after by row); for undo
invites       hash of a one-time link, name, role, card, expiry
settings      family name, language
api_tokens    agent tokens: hash, role, whether review is needed, revocation
proposals     drafts of edits from tokens: operations and the review result
user, session, account, verification — Better Auth tables
```

"Son", "daughter", "father" and "mother" are **not stored**. They are computed from `parent_child` and sex, so they cannot contradict each other.

Dates are inexact: "~1876", "1883 or 1886". So a date is stored as text, with a year beside it for sorting.

## Deployment

1. **Your own computer or server.** `install.sh` writes settings and starts the ready image from `docker-compose.yml`.
2. **Railway.** One service with one volume, built from the `Dockerfile`.
3. **First run.** The first person becomes the owner and chooses the language (English or Russian) and the family name.

All settings are environment variables (see `.env.example`). Optional ones: Google and Yandex OAuth, `SETUP_TOKEN` (protects an empty instance), `RECOVERY_TOKEN` (gets the owner back in), `OWNER_EMAIL` (the owner's address, so Google opens their account with no link). Email and S3 are not connected.

## Railway notes

- With a volume only one copy of the app can run, and the site is unavailable for a few seconds during an update. For a family this does not matter.
- Outgoing SMTP is closed on the Free and Hobby plans. That is why the basic sign-in uses invitation links and no email.

## Risks

1. **Inexact dates and disputed kinship.** Text dates and a certainty mark on facts and links.
2. **Privacy.** Living people are hidden from readers, photos need a sign-in, the site is closed to search engines, registration is closed.
3. **Signing in for relatives.** Older people find a link easier than a password. Google is not available to everyone, so Yandex ID is supported too.
4. **Data loss.** An automatic copy of the database before each migration, plus a full archive export.
5. **Our own layout.** Marriages across generations and between relatives produce long lines: the chart stays correct but less tidy.
6. **The face model.** The browser downloads the MediaPipe model file from Google's servers when you press "Find faces". The photos themselves go nowhere. Without a network, only manual tagging works.

## Several people at once

One process and synchronous SQLite: writes go strictly in turn and transactions do not overlap. So the thing to protect against is not database corruption but losing edits.

- **A field.** The editor sends `seen`: what it saw. If the value has since changed to something else, the server answers 409 and overwrites nothing (`lib/ops/merge.ts`). Without `seen`, the last write wins.
- **Lists (facts, sources, tags, versions).** These merge: what both added stays, and what one removed does not come back.
- **Page text.** Compared by version (`baseUpdatedAt`).
- **The assistant.** It reads the archive as of its answer (`actor.since`). If a person changed the card later, the write is refused, and the assistant rereads and decides again. At most four answers run at once, one per person.
- **Live updates.** `/api/events` (SSE) reports only the fact of a change and who is present. The page fetches the data itself, with its own permissions, so a reader learns nothing extra. A hidden tab closes the channel. This assumes one process: several replicas would need a shared bus.
- **Reading.** The graph is parsed once per change and shared by everyone (`getGraph`; it must not be changed, and tests freeze it). An unchanged graph is answered with 304.

## The chart on the page

The page holds only what is visible, plus about 0.4 of a screen on each side (`lib/graph/visible.ts`). During an animated move both places are on the page: from and to. The `+` buttons appear only on the card under the pointer or in focus. Below scale 0.25, labels and click zones on lines are hidden: they cannot be read and cost a lot to draw. Keyboard: Tab goes through visible cards and moves the chart, and search finds everyone else.

`components/graph-canvas.tsx` only puts the parts together:

- `chart-view.ts`: pan, zoom, what to keep on the page;
- `chart-light.ts`: highlighting relatives, paths and groups;
- `chart-links.ts`: dragging a link;
- `chart-selection.ts`: selecting and deleting a line.

Rarely used panels (settings, import, photos, history, kinship, assistant edits) load on first opening.

## What the live channel survives

- The server sends a `ping` every 25 seconds. A page that hears nothing for 70 seconds reopens the channel, so it survives a sleeping laptop and a network change.
- The browser treats an error response, such as a 502 during a deploy, as final, so `use-live` reconnects by itself with a growing, randomized pause.
- Presence goes out at most every 200 ms and is computed once per user, so all pages return at once after a restart.
- A page that stopped reading and piled up 100 messages is disconnected by the server. Pages over the limit of 300 get a 503.

## How the chart is laid out

The layered method (Sugiyama): generations, order within a row, horizontal position, lines. A couple or a chain of marriages stands as one block.

- `lib/graph/layout.ts` puts it all together. Dagre decides only who is in which generation and gives the first order.
- `lib/graph/order.ts` looks for the order with the fewest crossings: sweeps over rows by the average position of relatives, then moving each block to its best place (sifting) and flipping a couple. A line to children across a generation takes its own place in the row between, so it does not run through people.
- `lib/graph/tracks.ts` decides at what height each bus runs in the gap between rows (Eschbach, Günther, Becker, *Orthogonal Hypergraph Drawing*, JGAA 2006). The gap grows if there are many buses.
- Partners stand 178 apart and a label is at most 162 wide, so the line down from their dot never goes under a name.
- The order depends only on the family's shape and is cached: editing a name moves no one sideways.

Quality is measured on the finished geometry in `tests/layout-quality.ts`: crossings, overlaps, lines through cards. Finding an order with no crossings at all is NP-hard in general, so tangled families with marriages between relatives keep some crossings.

## Where things are

- `lib/api/routes/*`: routes by section, `lib/api/router.ts`: route descriptions and OpenAPI.
- `lib/ops/privacy.ts`: what is hidden from a reader. Every new way out for data goes through it.
- `lib/ops/core.ts`, `REFERENCES`: who refers to whom. A new table that refers to a person or photo is added here, or a test fails.
- `lib/storage.ts`: files on the volume, written only by renaming.
- `lib/graph/metrics.ts`: sizes on the chart, `lib/graph/select.ts`: who belongs to a part of the family.
- `lib/i18n.ts`: the interface's words. The Russian text is the key and English is the lookup.
- `components/settings/*`: settings sections.

## Checks

`pnpm check`: types, tests, import cycles. `pnpm check:full`: browser scenarios, text metrics, speed budgets and crash scenarios in throwaway containers with an invented family; no paid models are called. `SOAK=10 pnpm check:full` adds a 10-minute load.

A new word in the interface needs English in `lib/i18n.ts`: `tests/i18n-coverage.test.ts` fails without it. `tests/e2e/english-everywhere.mjs` presses everything as each role and looks for Russian on screens, in system dialogs and in answers. `BUDGET_S=600` makes it a full pass of about half an hour.

## Views

The `views` table holds no facts about the family and is not part of history: only which part to show and where manually placed cards stand. The `main` row keeps positions for the chart with no filter. The filter works in the browser (`components/chart-scope.ts`, `lib/graph/select.ts`) on top of the graph already received, so the server, not the view, decides what a reader sees. A pinned card gets a large weight in `placeInOrder`, and the others make room.

## Printing

The PDF is built in the browser (`lib/print-chart.ts`, loaded only on the button) from the same layout in dense mode, `layoutFamily(g, { print: true })`, not from a screenshot. Lines and text are vector, and fonts from `public/fonts` are embedded as a subset. What a reader cannot see is not in the file, because the browser never received it; the owner's living relatives are hidden by a mask before layout.

`lib/graph/print-plan.ts` computes the scale and sheets. Taping sheets together cuts by generation bands: a vertical cut has to pass between people of every generation in the band, so a band takes as many generations as can be cut without loss. If a sheet is smaller than a card, the plan reports `cutsCard` and the window warns.

## Guests and suggestions

A guest arrives by a viewing link and has no account. `getActor` does not know them, so the live channel, backups, the assistant and MCP answer 401 by themselves. Only `/api/v1` and the `/` page ask about them, and a route lets a guest in only if declared through `open(...)`: that means reading, and `tests/share.test.ts` checks the list. Otherwise a guest equals a reader: the same masks, and with a link to a view, people outside the view are removed from the chart and closed in pages and photos. The `/share/<token>` page says nothing about the family and gives nothing away without a press, because messenger previews may read it. The database holds only the token's hash, and the cookie stops working when the link is closed, expires, or its view is deleted.

A reader writes only through `POST proposals/suggest` (`lib/ops/suggest.ts`): fields from a short list and text that becomes a page. Ordinary write routes stay closed. A suggestion goes into the shared `proposals` queue, whose author is now a token or a person. `seen` is taken on the server at the moment of suggesting, so accepting cannot overwrite a later edit: the draft stays with a reason.

## Stories

`stories` and `story_people` are part of history, like pages. A story does not change facts about a person: a fact appears only through a separate action and names the story as its source. A voice recording lives in `media` with `kind = 'audio'` and goes into the archive copy with other files, but it is not in photo lists and can be read only through `stories/:id/audio`, which streams the file and understands `Range`. The file is stored as is, and its type comes from the first bytes, not the name.

A story is hidden from a reader and a guest if anyone among its people or its teller is hidden. A voice without a teller's card and a name without a card are not given to a reader: it may be a living person. Tokens and models get no stories: `create_story` is marked `internal` and is not among the tools, and reading is forbidden to them. `MAX_AUDIO_MB` limits the space for voices, 5000 by default.

## The person card

A value is never cut, at any length. The editing field is `GrowText`: a textarea over a hidden copy of the text that sets the size. For reading, a value is shown as text through `ReadText`, with clickable addresses. Adding goes through `AddMenu`, not `select`: an action should not look like a field with a value. `decorateBlocks` from `lib/linkify.ts` formats addresses and file names on pages when shown, and this reaches the database only if the page is edited.

`tests/e2e/card.mjs` checks the card on extreme data: five cases, five tabs, five widths, owner and reader. It counts overlaps, overflow, cut text, horizontal scrolling, small targets, raw addresses and lack of room for content. It also checks that editing, saving and hints work. Metrics do not replace looking: a second round of reviewing screenshots found defects at 100% on metrics.

## Merging cards

`lib/ops/merge-people.ts`. Everything beyond facts and links goes through `Changes`, so undo restores the database exactly: `tests/merge-people.test.ts` checks this on 500 random pairs. The check for whether a merge is possible (`whyNot`) computes kinship as if the cards were already one, and repeats inside the write along with comparing `updatedAt`. Accounts, invitations, views and waiting drafts are not part of history: they follow the person and do not come back after undo. A new table that refers to a person has to go into both `REFERENCES` and `movePeopleLinks`/`moveContent`.

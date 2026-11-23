# Changelog

All notable changes are listed here, newest first. Versions follow [Semantic Versioning](https://semver.org). Each version is a Git tag, and ready images are at `ghcr.io/danarkhipov/folkbranch`.

## Unreleased

### Added
- **A public demo you can host.** With `FOLKBRANCH_DEMO=1` and the router in `demo/`, every visitor gets their own throwaway copy with an invented family, signed in with no sign-up, and the assistant works within limits; keys, accounts, mail, updates and restores are closed. Nothing changes on a normal install. See `docs/DEMO.md`.

## 1.8.0 - 2026-11-18

Folkbranch 1.8.0 lets you correct the family chart with your hands instead of deleting and re-entering people, makes the map tell the truth when you rewind it, and opens the app to more languages. The assistant does bulk edits in one step and can be pointed at any AI service you choose.

### Highlights

- **Fix a wrong link by dragging it.** Click a line on the chart and drag its end onto the right person: the wrong parent becomes the right one, one step in History, one Undo.
- **Change whose child someone is in one move.** Drag a child's handle onto a parent, or onto the dot between two parents, and the card says what will happen before you let go.
- **A chart that reads like a genogram.** Unmarried partners are dashed, a divorce has two slashes, a separation one, and adopted, foster and step children each have their own line, with a legend on the chart.
- **A map you can trust when you rewind.** Each traveller has one line, and a person's lines leave with their death year and come back when you turn the clock back. A new switch keeps the people who have died on the map, faded, where they lived.
- **Ask a relative for a story with a link** straight from their card, and hear what came back in place.
- **More languages.** Portuguese, French, German, Italian, Ukrainian and Polish arrive as a beta, and adding another is one file.
- **Your own AI provider.** Connect any OpenAI-compatible service from Settings > AI; the assistant uses fewer tokens and makes one call for a change to many people.
- **Safer for readers and agents.** Hidden living relatives stay hidden everywhere an agent or a reader can look, and mistakes in a request are explained in plain words.

### Upgrading

- Run the install command again (`curl -fsSL https://raw.githubusercontent.com/danarkhipov/folkbranch/main/install.sh | sh`), or `docker compose pull && docker compose up -d`. Your archive and photos stay where they are.
- One additive migration (how a union ended) runs by itself; the server copies the database first, and nothing needs to be configured.

### Fixed
- The assistant makes one `update_people` call for a change to many people, as its instructions say: the tool is now sent with every request, so a small model no longer writes one `update_person` call per person (and an undo restores them all at once).
- An assistant or an outside agent reading a person now sees how each union stands (together, separated, divorced or widowed), not only the dates: it could set the state but not read it.
- On the map a person's faint line no longer runs on to an empty place after their life ends: it leaves with them.
- On the chart, dropping a couple's dot on a child who had only one of them now adds the other parent (as mother or father by sex). Before, it did nothing and said the people were already linked. A child who has a parent outside the couple, or two parents already, is refused with a reason.
- The "Thinking" line under your first message no longer drops a few pixels a moment after it appears, and the answer starts in its place instead of jumping up.
- A brother or sister is no longer called a half-brother or half-sister when only one of them has a second parent on record: the missing parent may be the shared one.
- Settings > AI: the units on the usage cards ("this month", "tokens today") are no longer cut off by the card's edge, and the assistant's tokens for the day are said once.
- **Privacy for readers and agents.** A hidden person answers `get_people` exactly like an id that does not exist, and no overview, count or relative list for a reader says how many people are hidden; a reader's GEDCOM has no record, not even an unnamed one, for someone they may not see. Direction marks and control characters are removed from every text a write carries (a name could read backwards). History names the token, not an internal id. A mistyped key in a filter or a person's fields is refused by name instead of returning everyone; an empty year range is said.
- **Tools say what happened.** A read-only token that asks for a writing tool is told why; a wrong input is explained in a sentence before the exact issues; undoing twice says what was undone and what already is. Impossible calendar dates (31 February) are refused; `import_text` names a key it does not know (`div:`); `add_version` returns the id of the version it recorded; linking people already linked, or a person to themself, says so; place kinds written in English ("town") become the archive's own word.
- **Search and answers agree.** `search_people` forgives a typo in a name; `get_relatives`, `count_relatives` and the immediate family count the same relatives (an adopted child is not blood, a step-child is in the immediate family); `export_text` leaves the living out like the GEDCOM export; history names both ends of a link and shows real before and after.

### Added
- **People who have died** is a switch in the map's layers: on, a person stays on the map, faded, where they were last placed, with every move they made, so the dead are seen with where they lived. The **Follow** button says who it follows ("Follow Anna", or "Follow the family") and what it does when pointed at.
- **An existing link can be moved.** Click a line on the chart and a handle appears on each end; drag one onto another person to move that end there: the wrong parent becomes the right one, the wrong child the right one, a partner is replaced. It is one entry in History and one Undo. A child with two parents replaces the one of the same sex as the new person. The assistant and the API have `move_relation` for the same.
- **Change whose child someone is by dragging.** Drag the child's own handle (the plus above the card) onto a parent they already have and the other parent link goes: they are now that parent's only child, shown as one line. Drop it on the dot between two parents and the child becomes a child of both: the missing parent is added and any other parent link is removed, whatever its kind (a link that stays keeps its kind). Over a target the tooltip says what the drop will do ("Make a child of both", "Make a child of X only") and the card or the dot lights up; a toast says what changed, with Undo, and the whole change is one entry in History. Dropping a couple's dot on a child with a parent outside the couple now replaces that parent too, instead of refusing. While a link is being drawn, a couple's dot has a wider drop reach so a finger can hit it. The assistant and the API have `set_parents` (`POST /api/v1/relations/set-parents`, `{childId, parentIds: [a] | [a, b]}`).
- **Unions as in a genogram.** Unmarried partners have a dashed line (a marriage a solid one). A divorce is two slashes across the line, a separation one slash; a union ended by a death is not crossed out, since the death shows on the card. The state is set from the line's bar or the couple's card (**together, separated, divorced, widowed**); an older end date with no reason reads as a divorce. GEDCOM writes a divorce as `DIV` and a separation as an event of type Separation, and reads both.
- **Foster children** are a kind of link next to birth, adopted and step. Adopted, foster and step each have their own line style, and the legend, in all four languages, explains every mark. GEDCOM and Gramps files carry foster children both ways (`PEDI foster`).
- **Ask a relative to tell a story from the person's own card**: **Ask to tell by a link** in the Stories tab (and in the **Add a story** dialog) opens a small dialog with the person already filled in; name who is asked, press ready questions, and the link comes out with **Copy** and, on a phone, **Share**. The card then lists open links ("Waiting for a story from Nina, link valid until…") with **New link** and **Close**, and what came back waits there with the teller's name, to hear and accept or reject in place. Editors can make and close these links, not only the owner.

- **More languages are easy to add.** English is now the language the interface is written in and every other language, Russian included, is one file in `locales/`; a language is loaded only when someone reads in it, and one line in the language list plus its file adds a new one. The first wave (Portuguese, French, German, Italian, Ukrainian, Polish) is machine-translated and marked **beta** in the language picker until a native reader signs it off. Languages with more than two plural forms, names written surname first, a patronymic in the full name and a different word for a father's and a mother's brother are now possible; lists sort in the reader's own alphabet. How to add or fix a language: [docs/TRANSLATING.md](docs/TRANSLATING.md).

- **Add your own AI provider** from Settings > AI: any OpenAI-protocol service by its address (name, address, key, model, **Load models**, **Test**), listed beside the built-in ones as "your provider", switchable, editable and removable. The key is encrypted like the others and bound to its address (changing the address asks for it again; a restored copy or settings file can never point it elsewhere); the address must be https (http only for this computer or a home network), and never a metadata, link-local or the app's own address; redirects are not followed. It serves the assistant, with tokens counted and the price shown as unknown. See [docs/AI_AND_FORMATS.md](docs/AI_AND_FORMATS.md).

- **Agents can do what the screen does.** Over MCP and in the assistant: story links (`list_story_requests`, `create_story_request`, `revoke_story_request`), duplicate cards and merges (`find_duplicates`, `preview_merge`, `list_similar_places`, `merge_places`), point candidates for places (`get_place_suggestions`), taking changes back (`undo_person`, and `rollback_to` for the owner in the chat), and `view_photo` over MCP. A test fails when a route or operation has no tool and no reason. Merging two cards stays a person's own act. See [docs/AI_AND_FORMATS.md](docs/AI_AND_FORMATS.md).

- **Bulk work agents can trust.** The overview says which tools wait for review; the owner can let a trusted editor token apply bulk edits (not imports) at once; a draft lists the people in it. `delete_people` and `link_people` do many in one change with one undo, `update_people` reports every bad entry, `query_people` filters by surname, birth or death place and by what is missing, `find_gaps` by field and order, and `get_statistics` and `find_overlaps` answer "average age at death by generation" and "who lived in the same place at the same time". `create_person` can carry a spouse's union dates.
- The list of MCP tools is smaller: 36 KB instead of 45 KB with the new tools (limits are still enforced and said in words).

### Changed
- **Tidier lines on the family chart.** A couple now stands between its parents and its children, not under its parents only, so a child is no longer drawn far across the chart from its parents: on a generated 2,000-person family the average line is a fifteenth as far across, the gaps between rows stay level (one was 1,525 px tall) and the crossings fall from 252 to 0. A child a few pixels off the stem of its parents is moved into line, so the stem no longer takes a small jog with squeezed corners; where a neighbour stands in the way, it is pushed the few pixels along instead, which removes most of the remaining squeezed corners. A partner whose lines run mostly one way now stands on that side of the couple, which shortens lines and removes a few crossings.
- While the assistant works, the panel says what the step is about: the person whose card it reads (name and a small avatar that opens them on the chart), "12 of 40" for a long read, and the fact it is writing. The assistant can also read many cards in one call (`get_people`) and add one fact to many people (`add_fact_to_people`) with one confirmation and one undo.
- The assistant answers "how many relatives" in two round trips instead of five, with about a third of the tokens: a new `count_relatives` tool (also over MCP) returns counts by kind (blood, adopted, step, spouse, by marriage) and degree, with names only on request. A spouse of a blood relative is counted as a relative by marriage, never as a blood relative.
- Each answer from the assistant shows the time it came and how long it took ("14:32 · 12 s"); on a long answer, opening it shows the steps and tokens. It is kept with the conversation on this device. Older answers show nothing.
- Printing the chart as a picture or PDF starts with names shown for the owner. Before, the box **Hide living relatives** was ticked every time, so a family with many living people came out as a page of "Living relative". Tick the box to hide them before sending the file to anyone. Editors start with the box ticked as before, and readers never receive the names.
- A phrase a language has not translated yet shows in English everywhere, never in Russian.
- `pnpm i18n:check` (also in CI) replaces the old Spanish and Catalan table tests: it fails on a missing, unused or mismatched translation.
- A traveller on the map has one line: while a journey is under way the earlier one leaves the faint trail, and it returns when the clock turns back. Rewinding the time brings back and removes lines the same way as playing it forward, and a person's lines vanish with their death year and return with it.
- Settings > AI follows the same type sizes and control heights as the other pages: each row's name and hint are separate, hints wrap instead of being cut off, icon buttons have names, and the Russian wording says "services", "address" and "access key" instead of "providers", "URL" and "token".
- A spouse can be given how the union ended (divorced, separated, widowed) when created through an agent or the assistant; an impossible union date is refused, and adding a couple who are already married says so.
- The setup screen lists English first again.
- The first screen loads about 20 KB more script than 1.7.0 (373 KB, measured with the same tool as 353 KB for 1.7.0), because translations now load on demand through i18next.

## 1.7.0 - 2026-11-17

The family on a map, year by year. It began as [pull request #14](https://github.com/danarkhipov/Folkbranch/pull/14) by [@andratwiro](https://github.com/andratwiro): thank you. On top of it this release tells two villages of one name apart, suggests points for places that have none, imports Gramps files with their places, and guards the archive against several easy mistakes.

### Security
- A reader no longer sees the date or place of a marriage to someone hidden from them, nor which place record a hidden person was born or died in.

### Added
- **The map**: the family on a map, year by year. Press Play and people move between the places of their births, marriages, moves and deaths, or drag through the years, or step from one event to the next. Pick someone to see their whole life as a numbered route; press a town to see who lived there that year. Pick an ancestor and choose **Line to you** to follow the family's line down the generations to you. The map comes with the app, so nothing is asked of another server. ([#14](https://github.com/danarkhipov/Folkbranch/pull/14), by [@andratwiro](https://github.com/andratwiro))
- **Map layers**, one button in the corner with the zoom, as map apps have them: switches for people, event marks and routes, a switch for every past move, and check boxes for which kinds of place count (births, marriages, moves, work, deaths), so you can show only where people died, say. A dot on the button says something is switched off; **Reset** puts everything back. Remembered in this browser; in all four languages.
- On the map a move is a nearly straight line from one place to the next, bowed just enough that the way there and the way back stay apart. Each person keeps their last move as a faint line for a generation, or, chosen in the map's key, every past move builds up into the family's pattern; pointing at someone draws their whole route dark.
- **Tree or map** is a switch at the bottom of both views, with the current one marked; arrows move between them and Back returns to the previous view.
- A key on the map says what the faces, routes and dashed legs mean; on a phone the timeline and its choices fit one row.
- A list on the map of events it cannot show, and why: no place, no point, no year, a place that could be one of two, a year still to come or a death written before the birth.
- **Two villages of one name** are told apart. A card keeps which place record it means beside the text; when two records answer, the card offers a choice and the map waits instead of guessing. "Ivanovka, Tver Governorate", written as GEDCOM writes places, finds the right one. When a second place of a name is added, everyone already written with the first stays with it.
- **Similar places** are listed with a one-press **Merge** that joins their names and moves every person to the kept one, as one change you can undo.
- **Points for places that have none**: up to three towns suggested from a GeoNames extract that comes with the app, matched on your server in any spelling and by old names in their years. One press sets the point; nothing is set unasked and no place name leaves the server.
- GEDCOM files carry place points both ways: a file from Gramps, RootsMagic, Legacy, MacFamilyTree or webtrees gives its points to places that have none, and the export writes each point.
- **Gramps files** (`.gramps`, and Gramps XML saved as `.xml`) import directly: people, marriages, children, events with godparents and witnesses, notes and sources, and every place with what it is part of, its map point and its older names with their years. An event is written with the name its place had then. Review, merge and undo work as for GEDCOM.
- **History** says what each change did: which people were added, changed (old → new) or removed, and for an import how many came in new and how many were updated or replaced. An entry about the whole archive opens in place instead of opening a card. The owner can **roll back to this point**, taking back that change and every later one, and take back one person of an import alone.
- **Ctrl+Z** (⌘Z) takes back your last change, **Ctrl+Shift+Z** or **Ctrl+Y** brings it back. In a text field the keys stay the field's own.
- The interface speaks the viewer's language: invitations, sign-in and setup follow the browser, and each person can pick their own interface language in their account settings. The archive's language still sets the language of the data.
- The assistant's conversations stay after a reload, and earlier ones open again from **Past conversations**. They are kept in this browser only.
- **One list of AI keys** in Settings → AI: a key is added once, in place, checked with its service first, and the assistant and speech each pick a service and model from it. The owner can pick who answers in the assistant.
- **Who used what**: requests, tokens and minutes per person this month, and calls per MCP access token. Money is only what the provider stated for each request (OpenRouter does); where a provider states none, the request is counted and the price is shown as unknown, never guessed.
- **The chart as a picture**: the whole family, what the chart shows, or one person's ancestors, descendants or close family, as a sharp PNG to send or print, or as a PDF, with the Folkbranch mark and the family's name.
- Each AI, speech and face service says how it keeps data, with its source and the date it was read. The data page says where everything is kept and what happens with time.
- A spreadsheet with columns of where people lived and when becomes residence facts on their cards, and the preview names the places the map will not have yet.

### Changed
- Server messages read in the language the person chose in the app, then their browser's, then the archive's.
- Yandex is told in every request not to log it or train on it; speech through OpenRouter asks for providers that do not collect data, as the assistant already did.
- The full archive copy no longer carries keys to AI services, sign-in methods or cloud speech and faces: after a restore they are added again.
- An API error from a malformed request is now a sentence in `error`; the details stay in `issues` (without the rejected input).
- The assistant says it is thinking as soon as a message is sent and whenever it is quiet between steps, with the seconds. Its steps read as one quiet line between its sentences ("Searching people · Reading a card") that opens to the list, and it says what it is about to change before each edit.
- A card glows for a moment where a change lands, whoever made it, the assistant included.
- Hovering a person, the glow runs down their line a generation at a time.
- The folded top bar is one small control with the logo and an arrow.
- A child added from the mother's card takes the father's surname, or the mother's in the child's own form (Petrova's son is Petrov), and "Oleg Petrovich" typed without a surname is a name and a patronymic.
- Under a date the card says at once when it cannot be right: a year still to come (with the century-back fix in one press), a death before the birth, an event before birth or long after death, a day no calendar has (31.02.1950), or no year at all.
- A coordinate pair pasted into the latitude field fills both fields; while typing, nothing is split early. A point in the sea or off the globe is refused, and a renamed place keeps its old name.
- The assistant warns when a place it writes is unknown, has no point or could be one of two.

### Fixed
- **Replace the tree** asks once more and says how many people will go.
- A parent, child or partner link taken away by its small cross leaves a note to give it back, and the cross says whose link it is.
- Edits still waiting for the server are counted on screen, and closing the tab asks first instead of losing them.
- Signing out of an account that came by invitation, with no email or account linked, warns that coming back will need a new link.
- Merging two cards keeps the place a birth, death or marriage was linked to; merging a place into one that sat inside it no longer leaves it under a place that is gone; a card linked to a deleted place waits for a choice instead of moving to a namesake.

### Updating from 1.6.0
Nothing to do. The database gains a few columns for place links on its first start; 1.6.0 still opens it if you go back. The assistant's key and a speech setup that used it move into the new list of keys by themselves, the old copy is kept so going back to 1.6.0 still works, and this month's transcription minutes still count toward the monthly limit. Spending recorded by 1.6.0 mixed stated prices and estimates, so it is not carried over as money.

## 1.6.0 - 2026-11-16

### Added
- **Update now**: on an install without Docker, one button updates the app. It saves and checks a copy of the database first, runs the installer of the new release, and the page comes back by itself; other installs are shown their one command or step. A dot on Settings says a new version is out.
- The owner sees on the setup screen when a newer release is out, with a link to what changed and how to update. The server asks GitHub at most twice a day and sends nothing about the archive; `FOLKBRANCH_UPDATE_CHECK=off` turns it off.
- Spanish and Catalan as archive languages, in Settings → General and on the first screen. A word not yet translated shows in English, never in Russian. Dates such as "12 de marzo de 1890" and "5 d'abril de 1931" are read in search, birthdays and GEDCOM export, a search finds García as Garcia and understands "la esposa de Iván" and "la dona de l'Ivan", and the assistant and speech recognition take the archive's language. The fictional demo family is in English for both for now.
- **Settings → AI and models**: one screen that shows what is connected (the assistant, cloud transcription, faces and voice on the device, stories by link), and one settings file for all of it. Download it, or load it into another archive: it holds no keys, says what it applied and what it could not and why.
- `OWNER_EMAIL` in the server's environment puts the owner's address on their account, so "Sign in with Google" opens it with no link to open first. No other Google account gets in.
- A check that no commit names an AI assistant as author or co-author: a `commit-msg` and a `pre-push` hook in `.githooks`, and a CI job.

### Changed
- A child with one parent on record is no longer called a stepchild of that parent's partner, since the partner may be the other parent: the chart says "husband's son" or "father's wife" instead. With the other parent on record as someone else, "stepson" and "stepfather" stay.
- The check asks for a second parent when a brother or sister through the same parent has both on record.
- In an English archive the years of a living person end in "now" on the server too (search, exports, the sheet), as on the screen.
- Long relation labels on the chart wrap onto up to three lines within the card instead of running into the neighbours, and show whole under the cursor; the chart rows are a little taller for it.
- A new archive opens straight on the chart with its first actions; what to set up next stays in Settings instead of a window over the first screen.
- The connection check every 15 seconds runs only while the live line to the server is down.
- `OWNER_EMAIL` sets the owner's address only over a stand-in or its own earlier value, so an address the owner chose in the app stays.

### Fixed
- Updating from 1.5.1 or older with the install command while a page of the app is open: the old version did not stop, the new one landed beside it, and the app was down once the page closed. The installer now ends a version that has not stopped in 30 seconds before it swaps the program.
- Stopping or updating the app no longer hangs while a page is open: the server closes its live lines when told to stop, and the launcher ends a server that has not stopped within 10 seconds. Before, an update with a page open could swap the program under a server that was still running, and the app stayed down afterwards.
- An agent's draft accepted after someone changed the same field no longer writes over that change: the draft waits with the reason, and facts and tags from both are kept.
- English labels: the button that rejects a face guess reads "No", the card picker "Choose a card", and the assistant's hint names its button as it is.
- Dependencies with known vulnerabilities: nodemailer 10.5 and a newer esbuild for drizzle-kit.

## 1.5.1 - 2026-11-09

The archives for installing without Docker now build and start on every system. Versions 1.2.0 to 1.5.0 came out without the archives for macOS and Windows; this is the first release that has all of them.

### Fixed
- The install command no longer hangs on macOS when the shell ignores a closed pipe, as on a build server: the random setup code is read from a finite piece of data.
- The archive for Windows builds: a newer `node-gyp` finds Visual Studio, and the packages are laid out flat, so the picture library finds its DLLs and the archive holds no links back into the build folder.
- The release workflow can be run by hand to build and try the archives on all five systems without publishing anything.

## 1.5.0 - 2026-11-09

The assistant's models are tested, cheap and kept current: a model the provider takes away is replaced by itself. The owner can pay for cloud speech so that everyone can dictate. A guide shows new people what the app does.

### Added
- A guide to what the app can do, shown to a new person on the first visit and kept under the settings' tips: short cards for the chart, the assistant, stories, voice, faces and the rest.
- Cloud speech: the owner connects a speech service once (OpenRouter, Groq, OpenAI, Mistral, SiliconFlow or a server of their own) and pays for it. Every editor then dictates and transcribes recordings through the server, which keeps the key and keeps no recording. A monthly limit of minutes protects the wallet.
- Stronger speech models on the device for English (Whisper small and turbo), beside GigaAM for Russian.
- Each AI service is marked by how it is paid for (free or paid) and what happens to what you send, and a service we did not test is marked as not tested.
- Models are recommended only where we tested them: 97 scenarios on an invented family, GPT-6 Luna by default, and only cheap and recent models offered. The results are in `docs/MODEL_BENCHMARK.md`.
- The owner can leave the model on automatic: the newest model of a tested line that the provider lists is used, never an older one than the one tested.
- A model the provider took away is replaced by another of the same line, or a tested one of the service. OpenRouter gets backup models, and speech services fall back to their other models.
- `docs/RELEASING.md`: how a version is chosen and a release is cut, and a test that the version and the changelog agree.

### Changed
- A model is described in one plain sentence.

### Removed
- The old Qwen 3.6 model from the Cloud.ru list.

### Fixed
- DeepSeek and Kimi, used directly, no longer refuse a long conversation: their reasoning is sent back with the tool results.
- A GEDCOM with a repeated or missing record id no longer stops the import, and one odd entry in a provider's list of models no longer empties the list.
- A request a provider refuses is written to the server log with its cause, and the person is told that the provider may have changed its API.
- The map falls back to a second free tile server, the engine and model files to a second mirror, and the browser's cache of app files stops growing with every release.

## 1.4.0 - 2026-11-08

Sign in with Yandex ID, VK ID, Telegram, Google or a code by mail; assistant providers in Russia and China; load a tree together with its photos, by merging or replacing; a clearer chart with menus.

### Added
- The model list is read from the provider itself, newest first, with a mark for models that see pictures (OpenRouter, Anthropic and Moonshot say so). A model that cannot see is not offered the scan-reading tool, and the owner is told.
- Assistant providers in Russia and China: Yandex AI Studio, Cloud.ru (GigaChat, Qwen and others), DeepSeek and Moonshot (Kimi), chosen in the same list by region.
- Ways to sign in besides a link, each switched on by the owner under **Settings → Ways to sign in** with its steps, the return address and a check before saving: Yandex ID, VK ID (also Mail.ru and Odnoklassniki accounts), Telegram, Google, and a six-digit code by mail. Relatives link the ones they like under **My account** and add their own email there. Keys typed in the app are kept encrypted; server variables still win. See `docs/SIGN_IN.md`.
- Load a tree file in one of three ways: add to the family, merge with the people already there (the same person is found by name and dates and nothing is doubled), or replace everything. The dialog says beforehand how many people would be added, matched and linked.
- Load a tree together with its photos and files: drop them in one go, and each picture is attached to the people it belongs to, by the file's own links, by the person's id in its name, or by name.
- A right-click menu on the chart. On a person: open, add a parent, a spouse or a child, delete. On an empty place: add a person there, load a file, search, show everyone, flip the chart, delete the whole chart. A person added from the menu stands where it was pressed.
- An empty chart offers to load a tree file, beside the first person.
- Hovering a person lights their whole line outward, ancestors and descendants. A press on the chart closes open menus.
- A living person's dates read `1950 –`, open at the end, not as a finished life.
- While a new version is put in place, the page waits and reopens by itself instead of showing an error.

### Changed
- The chart's rows follow birth years, so relatives of one age stand level. Lines keep clear of each other and each branch keeps to one stretch of its row.
- The family overview, places, checks and search follow the part of the family chosen under **Who to show**, and say so.

### Fixed
- A GEDCOM event, source or page written over several lines is read whole.
- A long name on the chart is cut after three lines, so it cannot run into the lines and rows below.
- A small disk with room to spare is no longer reported as full.
- Cloud.ru models are read from its own list, with what each can do: tools, pictures and prices in roubles.

## 1.3.0 - 2026-11-08

The family's records: places, archives and the people at an event, a calendar of family days, a fan of ancestors, private people and stories, a printed page, and a safer sign-out.

### Security
- Signing out empties the browser's cache of photos and removes text never sent and face prints, so the next person at a shared computer finds nothing. It asks first when there is unsent text. Photos are no longer kept for a year without asking the server: a copy left by someone else's session opens only for those allowed to see it.
- Text kept in the browser while offline is offered back only to the account that typed it.

### Added
- A map of the family's places under **Dates, places and archives**, and each life's places in order under **Life in order**. The map comes from OpenStreetMap, so each device allows it once before the first picture is fetched; names and dates never go there.
- The assistant looks at photos and scans already in the archive, a picture or a PDF, and reads them, handwriting included, then proposes what they show with the document as the source.
- The assistant and agents add and change places: what a place was part of, its old names and its point on a map, each change waiting for review from a token.
- The assistant shows a person's ancestors, descendants or close family on the chart when asked.
- Places as records, under **Dates, places and archives**: what a place was part of, its old names and when they held, and where it is on a map. Search finds people by an old name too.
- Archives as records with an address and a site, chosen for each source. A source also keeps its record number, the date of the document and a transcription.
- People at an event, each with a role: godparent, witness, priest. Those with a card link to it, and readers see no one hidden.
- Fields of their own for military service (unit, rank), looks, a wound, captivity, an award and a membership. New kinds of fact: estate, title, languages.
- "No children" and "never married" on a person's family, so the check stops asking.
- Addresses and phones of living relatives, seen only by editors: never by readers, guests, agents, the file for relatives or GEDCOM.
- Keep a person who died, or a single story, from readers, guests and read-only agents, as the living are kept. GEDCOM carries the mark both ways.
- Ask for a story with up to five questions, from a ready list or your own. The relative picks one before each recording, and it names what they send.
- The server copies the database by itself each day and keeps the last seven. **Settings → Data and backups** says when it last did, and can copy now.
- Print a person, or keep them as a PDF: life in order, family, facts, biography, stories and sources.
- A calendar file of the family's days for a phone or computer, from **Dates and numbers**.
- Moving from Gramps and webtrees, checked on files written their way: baptism and other events, the surname from birth, periods of residence, godparents, private marks and the archive a source is kept in now come across. See `docs/MOVING.md`.
- **Dates and numbers** on the chart's toolbar: birthdays and anniversaries of the next two months, and the family in numbers.
- An **ancestor fan** for any person: the whole line in one picture, under **Who to show**.
- **Life in order** in a person's details: birth, marriage, children, facts and death, read from what is already written.
- A page of its own when there is no connection, and a page for a link that leads nowhere, in place of the browser's own.

### Changed
- On a phone, settings open as a list, one section at a time; the bottom bar no longer runs its labels together.
- A person's card: details come first, the bin and the history moved to a menu, and an empty field no longer offers a source.
- Clearer words in the settings: no MCP or "smart functions" in the names, the full copy comes first, and a failed action says so and stays until read.
- The first screen loads less: search and adding a relative come when first used.

### Fixed
- One fact changed on two devices at once: the second is now told, as for a single field, instead of one edit silently replacing the other. A fact one device changed is no longer removed by the other.

## 1.2.0 - 2026-11-07

Install on any computer without Docker, talk to the assistant, find familiar faces across all photos, and ask a relative for a story by a link.

### Security
- A restored copy can no longer point a file name outside the media folder.
- Readers no longer see the names of deleted people in the history.
- The assistant always asks before marking anyone as dead, since that shows them to readers.
- A sign-in on this computer refuses what arrived through a tunnel or proxy.

### Added
- `--server` installs on any Linux server in one command, with no Docker and no domain: HTTPS by itself, a service that starts with the server, and nothing reachable from the internet running as root.
- An installer for Windows, `install.ps1`, checked when a release is built. Not proven yet: Docker remains the sure way there.
- `./folkbranch share` gives an install on your own computer an address on the internet for a while, so a relative can open a link. It asks first, and `./folkbranch share stop` closes it.
- `npx folkbranch` installs the app on the first run and opens it after that.
- Ask a relative for a story by a link: they open it on a phone, press one big button and talk, with no account and without seeing the archive. The recording waits for your review.
- Bring in a research case from the ex-ussr-kinship-research skill: pick its folder under **Settings → Files**, or an agent uses `import_kinship_case`. Candidates stay separate cards, unproved relations stay notes off the chart, and every status and source stays with what it describes. Bringing in the same case again only adds what is new to its cards.
- A plugin for Claude Code: `/plugin marketplace add danarkhipov/folkbranch`, then `/plugin install folkbranch@folkbranch`.
- `./folkbranch open` opens the app in the browser, signed in, and starts it if it was stopped. The first install without Docker opens the browser by itself.
- A file for relatives: one button under **Settings → Users and access** makes a single HTML file with the chart, cards and photos. It opens with no server, account or internet, and the living stay hidden.
- **Smart features**, switched on separately on each device under **Settings → Smart features**, and off by default apart from finding faces: suggesting who is in a photo from faces already tagged, and turning a recorded story into text in the browser. Photos and voice stay on the device; only the models are downloaded.
- Under **Check → Faces**: look through all photos for familiar faces, and set portraits for people who have none.
- Speak to the assistant instead of typing, with the words recognised on the device.
- Models download only when you press the button, in the settings or where a feature needs them, and can be removed again.
- Choose between models under **Settings → Smart features**: light, accurate or maximum for finding faces, and GigaAM or Whisper for speech.
- Faces are found with YuNet and compared with SFace, which handle old group photos far better than the earlier models. Finding and comparing runs away from the page.
- Install without Docker, on macOS and Linux. One command picks the lightest way: 23 MB if the computer has Node 24, about 48 MB with Node inside the folder. `--docker` and `--domain` still use Docker.
- `./folkbranch start`, `stop`, `restart`, `status` and `logs` for an install without Docker. It restarts itself after a crash and a restore.
- Hide all the panels: the bar narrows to a square around its logo, with its edge showing behind.
- The chart works from the keyboard: arrows through the family, + − 0 to zoom, a skip link, the list of keys under How to read the chart, and focus that returns when a panel closes. Screen readers hear the relation on each card.
- A History tab in each person's card: who changed what and when, what it was before, and a button to roll it back. The card says so when someone else changed it lately.
- Search looks through everything written about a person: dates in any form, places, facts, sources, biographies, stories and photo captions. It takes other word forms, nicknames, Latin letters, the wrong keyboard, typos and questions like "Ivan's wife", shows what it found in the results, and marks it in the card.

### Changed
- Settings are grouped and each screen says what it is for. View links have their own screen, the first screen links to the others instead of repeating their forms.
- One kit for the whole interface in `components/ui`: a styled dropdown instead of the browser's, one text field, copy buttons, switches. A test stops new copies.
- Every button with a `title` shows a designed hint, and the main ones say what they do.
- The history says who changed what, with the old and new value, and has a visible Roll back button on each entry.
- Review is its own panel: edits to approve, cards to fill in and similar people. The history shows only history.
- The AI assistant comes first in the top bar, with a clearer icon.
- Who to show on the chart: choose the person right in the menu, with one line on what each choice means.
- A key's name is no longer cut to one letter. Revoking a key asks first, and a new key lasts a year unless you choose otherwise.

### Removed
- The Relationship panel in the top bar.

### Fixed
- The install command run through `curl | sh` stopped before printing the setup link.

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

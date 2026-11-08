# AI, API and formats

An AI agent can connect to the app and change everything in it: upload, delete, change links. You can also paste text in the graph format, and it turns into cards.

## One set of operations, three ways in

All the logic lives in one operations layer. The app, the REST API and MCP call the same thing, so permissions and history work the same everywhere.

## MCP

Built into the app at `/api/mcp` (stateless Streamable HTTP, official TypeScript SDK). Nothing separate to deploy. Access is by token only.

Connecting Claude Code:

```bash
claude mcp add --transport http folkbranch https://your.domain/api/mcp --header "Authorization: Bearer fb_..."
```

Clients that need OAuth, such as claude.ai connectors, are not supported yet: the client has to be able to send a header.

Reading: `search_people`, `get_person`, `get_relatives`, `how_related`, `list_pages`, `get_page`, `list_photos`, `list_places`, `export_text`, `preview_text`, `export_gedcom`, `preview_gedcom`, `get_history`, `my_proposals`.

Writing (not listed for a read-only token): `create_person`, `update_person`, `delete_person`, `add_relation`, `update_relation`, `remove_relation`, `remove_parent_links`, `create_page`, `update_page`, `move_page`, `delete_page`, `upload_photo`, `update_photo`, `delete_photo`, `tag_photo`, `untag_photo`, `set_avatar`, `create_place`, `update_place`, `import_text`, `import_gedcom`, `undo`.

Agents read and write pages in Markdown: a mention is `[@Name](person:ID)`, a photo is `![caption](/api/v1/media/ID/file?size=medium)`. Blocks Markdown cannot express, such as tables, are visible only with `raw: true`, and new text replaces the whole page.

## REST API

`/api/v1/…`, described at `/api/v1/openapi.json`. Send `Authorization: Bearer fb_...`. An edit sent for review returns 202 and `status: pending_review`. The app itself uses this same API.

## Tokens and safety

- The owner makes a token under **Settings → Agents and MCP**: read-only or editor. It can be revoked at any time. Only a hash is stored, and the token is shown once.
- **Living people.** A read-only token sees what a reader sees: living people are hidden. An editor token sees everyone, and that data goes to the model's provider, so you have to trust it.
- **Reviewing edits.** Writes from a token go into one draft per token. A person sees every line in words, can drop any of them, and accepts or rejects the rest. New people get a temporary `tmp_…` that works in later calls, and the draft is accepted in one transaction and one history entry. If anything fails, nothing is applied and the draft shows why.
- The owner can turn review off for a token. Bulk operations (`import_text`, `import_gedcom`) are reviewed anyway.
- History names the author: `Claude → Anna`. A token can undo only its own edits and cannot accept drafts.
- Users, invitations, settings and other tokens are closed to tokens: a route has to be allowed explicitly.
- `upload_photo` by URL does not reach internal addresses or follow redirects. In pages a token inserts only uploaded files, so an outside image cannot report every view.
- Page text is written by relatives, but a model may take it for commands. That is why review is on by default.

## The text graph format

The document button in the top bar shows text on the left and, on the right, how it lands on the chart and what changes. People are matched by `id`, otherwise by name and birth year, and doubtful matches are offered as a choice. The reverse operation turns the chart into the same text, so you can give it to a model and get it back with edits.

**Import only adds and changes.** A person missing from the text is not deleted, so a model's answer with part of the tree erases nothing.

It is based on the `family` format example from Diagrammo (https://diagrammo.app/docs/chart-family). A person is a line, a couple is `Name + Name`, children are indented lines under the couple. An example with invented people:

```text
family The Walkers
Peter Walker b: 1880, d: 1950, sex: m
Anna Smith b: 1885, sex: f
Peter Walker + Anna Smith m: 1905
  Mary Walker b: 1906, sex: f
  George Walker b: ~1910, sex: m
    Olive Walker kind: adopted, c: assumed
```

Person properties: `id`, `b`, `bp` (birthplace), `d`, `dp`, `sex`, `maiden`, `c` (`documented`, `family`, `assumed`). Couples: `m`, `end`, `union: civil`. On a child's line, `kind` (`adopted`, `step`) and `c` apply to the link with the parents. `@id` refers to a person whose name is not unique. Lines starting with `#` or `//` are comments.

It has not been fully compared with the original: the Diagrammo page did not open while the format was being made, so details may differ. Properties beyond the example are our extension.

A related project to compare with: Genmark (flat text compiled to GEDCOM 5.5.1), https://github.com/drewherron/genmark.

## GEDCOM

Import understands 5.5.1 and 7.0, export writes 5.5.1. Notes, events and sources become a Biography page on import. Export does not include pages and photos yet. This lets you move from and to MyHeritage, Gramps and FamilySearch. Import is deterministic, with no model involved, and has a preview. Export can hide living people.

## Importing files

Use the arrow button in the top bar, or drop a file on the chart. Excel (`.xlsx`), CSV/TSV and JSON are read in the browser and turned into the text format, so duplicate search, questions about ambiguous names and undo all work the same. Columns are recognized by their headings in English and Russian, and can be corrected by hand. A relative in a cell can be given by name or by row number. GEDCOM goes its own way and adds everyone as new; the window shows beforehand how many names already exist.

Identical names inside one file count as one person, and the window warns about it.

## How an agent should work

Start with `get_overview`, then `find_gaps`: that is the work queue. Record findings with `add_version` along with a source and its reliability: the old value stays, and a person sees the disagreement. `choose_version` and `reject_version` pick and reject versions. An agent converts a table with `parse_table`, checks it with `preview_text` and sends it with `import_text`. Ready MCP prompts: `research_person`, `fill_gaps`, `import_notes`. After making a token under **Settings → Agents and MCP**, you can copy the command for Claude Code, the config for other clients, or a task for the agent.

## Cloud transcription

The owner can connect one speech service for the whole archive under **Settings → Cloud transcription**. It is the owner's key and the owner's bill. Editors then turn recordings into text without keys or downloads: the recording goes to this server, which forwards it to the service and keeps nothing of it. A device uses it only if that device switches it on under **Settings → Faces and voice**; otherwise the voice stays on the device.

| Service | Model (default) | About | Where the audio goes |
|---|---|---|---|
| OpenRouter | mistralai/voxtral-mini-transcribe | $0.003 a minute; the exact cost of each request comes back; the assistant's OpenRouter key can be reused | OpenRouter |
| Groq | whisper-large-v3-turbo | about $0.04 an hour, free allowance; about 4.6% wrong words in English | USA |
| OpenAI | gpt-transcribe | $0.0045 a minute; about 3.3% wrong words in English | USA |
| Mistral | voxtral-mini-transcribe-latest | $0.0035 a minute | France |
| SiliconFlow | Qwen/Qwen3-ASR-1.7B | free models with limits; a Chinese service | China, Singapore |
| Your own server | any | anything that answers like OpenAI's `/audio/transcriptions`, such as faster-whisper | where you put it |

Prices and word-error figures are the services' own and independent comparisons as of 8 November 2026, a guide that changes. A key is checked by reading the service's model list, which costs nothing; the test button sends two seconds of silence, a fraction of a cent. A monthly limit (600 minutes unless changed) and eight recordings a minute per person keep one stuck button from spending the owner's money. The same can be set in the server's environment (`STT_PROVIDER`, `STT_API_KEY`, `STT_MODEL`, `STT_BASE_URL`, `STT_LIMIT_MINUTES`), and then it wins over the app. Alibaba's own DashScope service takes audio only as a link, so it is not offered directly; its Qwen3-ASR models are reachable through SiliconFlow.

## Models on the device and their licences

Folkbranch ships no model. A browser downloads one from its source only when someone presses its button under **Settings → Smart features**, and checks it against a fixed SHA-256.

| Model | Used for | Source | Licence |
|---|---|---|---|
| YuNet | Finding faces, light | [opencv/face_detection_yunet](https://huggingface.co/opencv/face_detection_yunet) | MIT |
| YOLOv8n-face, YOLOv11m-face | Finding faces, accurate and maximum | [deepghs/yolo-face](https://huggingface.co/deepghs/yolo-face), exported from [akanametov/yolo-face](https://github.com/akanametov/yolo-face) | GPL-3.0, from the original repository |
| SFace | Telling faces apart | [opencv/face_recognition_sface](https://huggingface.co/opencv/face_recognition_sface) | Apache-2.0 |
| GigaAM v3 | Russian speech | [istupakov/gigaam-v3-onnx](https://huggingface.co/istupakov/gigaam-v3-onnx) | MIT |
| Whisper base | Speech in other languages, light | [onnx-community/whisper-base](https://huggingface.co/onnx-community/whisper-base) | Apache-2.0 |
| Whisper small, small.en | Speech: medium, any language or English only | [onnx-community/whisper-small](https://huggingface.co/onnx-community/whisper-small), [whisper-small.en](https://huggingface.co/onnx-community/whisper-small.en) | Apache-2.0 (the OpenAI models they are converted from) |
| Whisper large-v3-turbo | Speech: maximum, any language | [onnx-community/whisper-large-v3-turbo](https://huggingface.co/onnx-community/whisper-large-v3-turbo) | MIT (the OpenAI model it is converted from) |
| ONNX Runtime Web | Running the models | [onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web) | MIT |

The face detectors, YuNet and the YOLO models alike, were trained on WIDER FACE, a dataset licensed for non-commercial use (CC BY-NC-ND 4.0). OpenCV releases YuNet under MIT all the same; whether the dataset's terms reach a trained model is not settled. For a family's own archive this does not matter. Anyone offering Folkbranch as a paid service should check it first.

### How the speech models compare

Measured with [`scripts/speech-eval.mjs`](../scripts/speech-eval.mjs) on 8 November 2026, with the models quantised to 8 bits as the app runs them, on a laptop processor. English: 40 clips of LibriSpeech test-other (noisy, 1,135 words). Russian: 40 clips of bond005/sova_rudevices (speech recorded on ordinary devices, 349 words). A small test, so differences of a point or two mean little.

| Model | Download | Wrong words, English | Wrong words, Russian | Speed against Whisper base |
|---|---|---|---|---|
| Whisper base | 85 MB | 15.9% | 39% | 1 |
| Whisper small.en | 250 MB | 4.9% | - | about 1/3 |
| Whisper small | 250 MB | 6.0% | 23.5% | about 1/3 |
| Whisper large-v3-turbo | 1.1 GB | 5.4% | 15.2% | about 1/5 |
| Distil-Whisper small.en | 170 MB | 9.5% | - | about 1/2 (left out: worse than small.en at a similar size) |

Checked on 8 November 2026. Each source's own licence file is the authority.

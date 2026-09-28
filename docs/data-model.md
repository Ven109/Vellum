# Data model and document format

This document defines Vellum's core entities and the on-disk/export format for documents. The
TypeScript source of truth is [`packages/core/src/model.ts`](../packages/core/src/model.ts) (Zod schemas,
which double as runtime validators) and [`packages/core/src/format.ts`](../packages/core/src/format.ts).

## Decision: portable Markdown + metadata, not opaque JSON

**Documents are exported and stored at rest as Markdown files with a YAML front-matter header.**

- _Portability._ An open-source writing tool must never trap writing. A folder of `.md` files opens in
  any editor, diffs in git and survives Vellum disappearing.
- _Live state is separate._ While a document is being edited, its state is a CRDT (see the sync spike,
  `docs/adr/0001-crdt-sync.md`). Markdown is the canonical _interchange_ format: snapshots, exports,
  imports and the desktop app's on-disk mirror all use it.
- _What does not fit in Markdown_ — comment threads, suggestions, version history — lives in JSON
  sidecars in a workspace export rather than being smuggled into the Markdown as custom syntax.

### Document file

```markdown
---
vellum: 1
id: doc_01j9x3k2mf8x0y4k7q2c1v5b9n6z
title: The tool nobody talks about
status: published
collection: Essays
tags:
  - craft
created: 2026-09-01T09:00:00.000Z
updated: 2026-09-12T16:21:44.000Z
published: 2026-09-12T16:21:44.000Z
---

# The tool nobody talks about

Every workshop has one tool nobody talks about.
```

| Key          | Required | Notes                                                                |
| ------------ | -------- | -------------------------------------------------------------------- |
| `vellum`     | yes      | Format version. Readers reject versions newer than they understand.  |
| `id`         | no       | Stable document id. Absent on files that did not come from Vellum.   |
| `title`      | no       | Falls back to the first `#` heading in the body.                     |
| `status`     | no       | `draft` (default), `in_review`, `approved`, `published`, `archived`. |
| `collection` | no       | Collection _name_ (names are portable, ids are not).                 |
| `tags`       | no       | List of strings.                                                     |
| `created` …  | no       | ISO-8601 timestamps.                                                 |

Plain Markdown with no front matter is valid input (this is how imports work).

### Workspace export layout

```text
my-workspace/
  workspace.json          # name, settings (house rules, voice traits, retention), collections, members
  Essays/                 # one folder per collection
    the-tool-nobody-talks-about.md
  Unfiled/
    notes.md
  .vellum/
    <document-id>/
      comments.json       # CommentThread[]
      suggestions.json    # Suggestion[]
      versions.json       # Version[] (each carries full Markdown)
```

## Entities

| Entity              | Purpose                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `User`              | A person with an account.                                                                     |
| `Workspace`         | Top-level container; owns settings, collections and documents.                                |
| `WorkspaceSettings` | Default model, house rules, voice profile, behaviour switches, retention, daily goal.         |
| `Member`            | A user's role in a workspace: `owner`, `admin`, `member`, `guest`.                            |
| `Collection`        | Named, coloured, ordered group. A document is in **at most one** collection.                  |
| `DocumentMeta`      | Title, status, owner, collection, tags, word count, optional per-document model override.     |
| `Version`           | Snapshot of a document with **mandatory attribution** (user, accepted suggestion, assistant). |
| `CommentThread`     | Comments anchored to a text range; can be resolved or orphaned.                               |
| `Suggestion`        | A tracked change (`before` → `after`) awaiting accept/dismiss.                                |
| `DocumentShare`     | Per-person or link share with role `view` < `comment` < `suggest` < `edit`, optional expiry.  |

### Identifiers

Ids are prefixed and time-sortable: `doc_`, `ver_`, `thr_`, … followed by 10 characters of timestamp and
16 random Crockford base32 characters. See `createId()`.

### Anchors

Comments and suggestions reference text through a `TextAnchor`: encoded CRDT relative positions for
`start` and `end` (which survive edits around them) plus the quoted text and a little context on either
side. If the relative positions cannot be resolved, the quote and context are used to re-anchor; if that
fails the thread is marked `orphaned` and kept, never silently dropped.

### Attribution

Every `Version` records who or what produced it. Assistant edits are always versions with
`author.kind = "assistant"`, carrying provider, model and the requesting user, so they are visible in
history.

### Retention

`RetentionPolicy` keeps all automatic snapshots for `keepAllForDays`, then one per day for
`keepDailyForDays`. Named versions are never pruned.

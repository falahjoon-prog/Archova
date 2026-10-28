# Schema: documents (documents, drawings, specifications, transmittals)

One module, `documents`, per [backend-modules §2](../../architecture/backend-modules.md#2-module-catalogue-and-boundaries); one Postgres schema `documents`. Table names are prefixed by sub-area. All tables are project-scoped and carry the standard columns. `file_id` columns reference `files.file_objects` by id (no cross-module FK).

## Documents

**documents.folders**
- `parent_id uuid null`, `name text`, `path ltree`, `is_private bool`, `allowed_user_ids uuid[]`, `allowed_company_ids uuid[]`
- unique `(project_id, parent_id, name)`; GiST on `path`

**documents.documents** — the logical document
- `folder_id uuid FK`, `title text`, `doc_number text`, `discipline text`, `doc_type text`
- `current_revision_id uuid null`, `status text CHECK (draft|for_review|approved|for_construction|superseded|void)`
- `custom jsonb`, `search tsvector`
- unique `(project_id, doc_number)` where not null and not deleted

**documents.document_revisions**
- `document_id uuid FK`, `rev text` (`A`, `B`, `01`), `file_id uuid`
- `status text CHECK (current|superseded)`, `issued_for text`, `issued_date date`, `notes text`
- unique `(document_id, rev)`; partial unique `(document_id) WHERE status = 'current'`

**documents.transmittals**
- `number int`, `subject text`, `purpose text CHECK (for_information|for_review|for_construction|for_tender|other)`
- `from_company_id uuid`, `sent_at timestamptz`, `sent_by uuid`, `response_due date`, `message jsonb`
- `status text CHECK (draft|sent)`; once `sent` the rows are immutable (trigger) and an `audit.evidence_records` entry is created

**documents.transmittal_items**
- `transmittal_id`, `revision_type text CHECK (document|drawing)`, `revision_id uuid`

**documents.transmittal_recipients**
- `transmittal_id`, `user_id uuid null`, `company_id uuid`, `email citext`, `role text CHECK (to|cc)`
- `delivered_at`, `opened_at`, `acknowledged_at`, `access_token_hash text` (link for non-users)

## Drawings

**documents.drawing_sets** — an issue batch ("IFC Set 3")
- `name text`, `issued_date date`, `received_date date`, `status text CHECK (processing|review|published)`

**documents.drawing_sheets** — the logical drawing (sheet number persists across revisions)
- `sheet_number text` (`A-101`), `title text`, `discipline text`, `area text`, `current_revision_id uuid null`
- unique `(project_id, sheet_number)`

**documents.drawing_revisions**
- `sheet_id uuid FK`, `set_id uuid FK`, `rev text`, `file_id uuid`, `page_index int` (when one PDF holds many sheets)
- `status text CHECK (current|superseded)`, `drawing_date date`
- `ocr_sheet_number text`, `ocr_title text`, `ocr_confidence real` (filled when the user accepts the AI title-block suggestion in `ai.ai_suggestions`)
- `tiles_prefix text`, `width_px int`, `height_px int`
- partial unique `(sheet_id) WHERE status = 'current'`

**documents.drawing_markups**
- `revision_id`, `owner_id uuid`, `owner_company_id uuid`, `visibility text CHECK (private|company|project)` (X12; `project` = published, becomes part of the record)
- `shapes jsonb` — vector shapes in normalised 0–1 coordinates, each with its own `id` so edits from two devices merge by shape; schema in `@archova/markup`
- `copied_from_id uuid null` (carried forward from a superseded revision, flagged "check location")

**documents.drawing_hyperlinks** — clickable regions linking to other sheets or records
- `revision_id`, `bbox jsonb`, `target_type text` (`sheet`, `rfi`, `defect`, `document`), `target_id uuid`, `source text CHECK (auto|manual)`

**documents.drawing_pins** — projection of records pinned on a sheet (written by defects/rfis via events, read for the "show on drawing" layer)
- `sheet_id`, `revision_id`, `entity_type`, `entity_id`, `x real`, `y real`, `status text`

## Specifications

**documents.spec_books** — `name`, `issued_date`, `file_id`
**documents.spec_sections**
- `book_id`, `section_number text` (`03 30 00`), `title text`, `division text`, `page_from int`, `page_to int`
- `revision text`, `status text CHECK (current|superseded)`, `search tsvector`

## As built (phase 1, first increment)

- `drawing_revisions` also has `status = 'draft'` for sheets in an unpublished set. A draft carries the title-block values (`sheet_number`, `title`, `discipline`, `issued_for`) and has no `sheet_id` until the set is published; `publish_reason` records why an older revision was made current; `superseded_by_id` feeds the "Superseded by Rev D" banner.
- `drawing_markups` adds `needs_location_check` and `published_at`. Published (`project`) markups can't be edited or deleted; carry-forward happens automatically when a set is published.
- `folders` uses `parent_id` only (no `ltree` yet); privacy is inherited down the tree in code.
- `transmittal_recipients` stores recipients without an account by email; their access links (X45) come with `shared.access_links`. Transmittal numbers come from `shared.counters` on send.
- Markups and drawing revisions use project paths (`{p}/drawing-revisions/{id}/…`) rather than `{o}/…`, so the API pipeline checks the project permission before the handler (ADR-0007).
- **As built: sheet geometry (X30).** `documents.sheet_geometry` has one row per drawing revision: `geometry_key` (S3 vector geometry, set by the files worker through the module API `recordSheetGeometry`, which emits `documents.sheet.geometry_ready.v1`), `scale_detected` and `scale_confirmed` as the N in 1:N, and who confirmed and when. `GET /drawing-revisions/{id}/geometry` returns `pending` with no scale before a row exists; `PUT .../scale` (needs `documents.drawings.manage`, optional If-Match) fixes the scale and never gets overwritten by the worker. The extraction itself belongs to the files worker and is not built.
- Not yet built: hyperlinks, pins, tiles, spec books and sections, and the files-worker split and title-block reading.
- **As built: tiles.** `GET /drawing-revisions/{id}/tiles` returns `pending` until the files worker calls `documents.api.recordDrawingTiles` (prefix exactly `orgs/{org}/projects/{project}/tiles/{revisionId}`, width, height; emits `documents.drawing.tiles_ready.v1`), then `ready` with `width`, `height`, `tileSize` 256, `levels` and one signed `tileUrlTemplate` (`{z}/{x}/{y}.webp`) plus `overviewUrl`, valid 6 hours. Signing is a CloudFront custom policy over the whole prefix (`API_FILES_CDN_DOMAIN`, `_KEY_PAIR_ID`, `_PRIVATE_KEY`, all or none, test-signed at start); local runs use a memory signer. The rasteriser itself is not built.

# 3. Photos, files, drawings and markup

## 3.1 Photos

### Capture
- In-app camera (`react-native-vision-camera`) for speed: open to shutter in under a second, burst of several shots, flash and torch toggle for dark areas.
- Photos can also be picked from the phone's library, with their original capture time and location read from EXIF.
- Each photo records: capture time, device GPS (if permission given), compass heading, project, and optionally the drawing and pin it was taken against.
- Photos are saved to the app sandbox first, not the camera roll, so site photos do not mix with personal ones. A setting allows also saving to the camera roll.

### Processing on device
- Resize to a long edge of 2,560 px and compress to JPEG (about 0.5 to 1 MB) for upload; HEIC from iPhones is converted. The original is optionally kept for a "full resolution" upload on Wi-Fi only.
- A small thumbnail is generated locally for instant lists.
- Photo annotation (arrows, circles, text, freehand) is drawn on a Skia canvas and stored as vector shapes over the photo, using the same markup format as drawings (3.4). A flattened copy is made for PDF exports on the server.
- Optional burned-in watermark (project name, date, time, location) for builders who need it for evidence.

### Upload
Follows the API's file rule ([api.md §3](../architecture/api.md#3-standard-behaviours-every-endpoint)): files never pass through the API.
- Every file goes through the `file_queue` (see [02-offline-sync.md](02-offline-sync.md)).
- The app calls `POST /uploads` for a presigned S3 URL (multipart for large files such as videos), uploads directly, then queues the `photos.create` or attachment command that references the upload ID.
- The files worker virus-scans, moves the object out of quarantine and makes renditions; the photo shows as "processing" on other devices until `files.object.ready` fires.
- Uploads run in a native background session so they continue when the app is closed (iOS background `URLSession`, Android `WorkManager`), and resume after a dropped connection.
- Settings: "Upload on mobile data" on by default for photos; off for full-resolution originals and videos.
- A file is deleted locally only after the server confirms it and the eviction rules allow it.

## 3.2 Drawings: download and cache

- The drawing register syncs as data. Sheet images are downloaded separately when the user opens a sheet or marks a set as offline (for example "All current architectural drawings, Level 1 to 4").
- **Only current revisions** are downloaded for offline by default. Superseded revisions are viewable online, and a superseded sheet is clearly bannered on screen.
- When a new revision arrives, the app downloads it in the background and marks open defects and markups whose pins may need checking.
- Cache limit is configurable (default 5 GB); least recently used sheets from non-offline projects are evicted first. Sheets in a project marked offline are never evicted automatically.

## 3.3 Drawing viewer

**Decision:** render from **server-generated image tiles**, not by parsing PDFs on the phone.

- When a drawing revision is uploaded, the files worker rasterises each sheet into a deep-zoom tile pyramid ([data-architecture §4](../architecture/data-architecture.md#4-files-pipeline)); the revision record carries `tiles_prefix`, `width_px` and `height_px`. Mobile asks for 256 px WebP tiles plus one low-resolution overview image.
- The app shows the overview instantly and loads tiles as the user zooms, in a Skia canvas with smooth pinch-zoom and pan. An A0 sheet stays fast on a low-end Android phone.
- Fallback: if tiles are not yet ready, the app shows the PDF with the platform PDF renderer (PDFKit / PdfRenderer) via a native module.
- Text search within a sheet uses the OCR text from the same worker. Hyperlinks between sheets and to records come from `drawings.hyperlinks` and sync as data.
- Viewer features: sheet-to-sheet navigation, revision compare (overlay old and new in two colours, phase 3+), measure tool calibrated from the sheet scale, current location dot when the sheet is geo-referenced (later).

## 3.4 Markup format (shared with web)

Markups are vector data in `drawings.markups.shapes` (Ben's schema), not burned into images, so they survive zooming, stay editable and can be filtered by author or layer.

- Coordinates are **normalised to the sheet** (0 to 1 on both axes, origin top left), so they are independent of tile resolution and device. This matches `defects.pin_x`, `pin_y` and `drawings.pins`.
- Markups belong to a specific drawing revision.
- Shape types: pin, arrow, line, polyline, rectangle, ellipse, cloud (revision cloud), freehand, text, callout, measurement, highlight.
- Each shape: `id`, `type`, `points`, `style` (colour, stroke, fill, opacity), `text`, `author_id`, `created_at`, optional link to an entity (defect, RFI, photo, observation).
- Visibility: `private` (only me), `company` (my company) or `project` (everyone on the project), per the cross-team decision X12. Project markup becomes part of the record.
- The shape schema, geometry, hit-testing and normalisation live in `@archova/markup` ([ADR-0006](../architecture/adr/0006-shared-client-packages.md)), used by mobile, web and the server PDF exporter, so a markup drawn on a phone looks identical on the web and in exported PDFs.
- Each markup record belongs to one owner, revision and layer, so two people marking up the same sheet offline never collide. If the same person edits on two devices, the server merges by shape `id` (each shape carries its own ID), so added shapes from both devices survive.

### Carrying markup to a new revision
When a sheet is superseded, project markups and open defect pins are offered for copy to the new revision at the same normalised position, with a "check location" flag, because sheet layouts can shift between revisions.

## 3.5 Pins: defects, RFIs, photos and observations on drawings

- Long-press on a sheet to create a defect, observation, RFI or photo at that point.
- Pins are colour-coded by type and status, clustered when zoomed out, filterable (my items, by trade, by status).
- Tapping a pin opens a bottom sheet with the item; on tablets it opens beside the drawing.
- Location text ("Level 3, Unit 305, Bathroom") is suggested from the sheet title and area tags when available.

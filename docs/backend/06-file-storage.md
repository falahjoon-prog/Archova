# 06. File storage

**Owner:** Ben · **Status:** Draft v1 · **Last updated:** 2 Oct 2026 · Back to [README](README.md)

Pipeline shape from [data-architecture §4](../architecture/data-architecture.md#4-files-pipeline); security rules from Sam's [03 §4](../security-licensing/03-tenant-isolation.md); evidence rules from Sam's [07 §5](../security-licensing/07-audit-logging.md). Files never pass through API servers.

## 1. Buckets (S3, ap-southeast-2, Block Public Access on, SSE-KMS)

| Bucket | Holds | Settings |
|---|---|---|
| `<env>-files` | originals and renditions under `quarantine/` and `orgs/` | versioning on; Intelligent-Tiering after 90 days; replicated to Melbourne |
| `<env>-evidence` | sealed PDFs + canonical JSON of issued claims, schedules, variations, notices, transmittals; audit chain anchors; archived audit partitions | **Object Lock, compliance mode**; retention per Sam 07 §6: **10 years after practical completion**, or after the occupation certificate date if one is recorded; orgs can extend, never shorten (confirmed by john, 2 Oct 2026); replicated |
| `<env>-exports` | bulk exports, evidence packs | 7-day expiry |

Downloads go through CloudFront with signed URLs (5 minutes for originals, longer for immutable tile/thumbnail keys).

## 2. Key layout

```
quarantine/{uploadId}                                              # landing zone, scanned before anything else
orgs/{orgId}/projects/{projectId}/{module}/{fileId}/original
orgs/{orgId}/projects/{projectId}/{module}/{fileId}/thumb_256.webp
orgs/{orgId}/projects/{projectId}/{module}/{fileId}/preview_1600.webp
orgs/{orgId}/projects/{projectId}/{module}/{fileId}/tiles/{z}/{x}/{y}.webp
orgs/{orgId}/_org/{module}/{fileId}/…                              # org-level files (logos, templates)
orgs/{orgId}/credentials/{workerId}/{fileId}/…                     # white cards, licences, ID images (X58): never indexed
orgs/{orgId}/projects/{projectId}/documents/{revisionId}/geometry/{sheet}  # vector geometry for takeoff (X30)
```

No user-controlled names in keys (the original filename is metadata, returned via `Content-Disposition`). The org prefix supports per-tenant IAM conditions, tenant export, cell moves and deletion.

## 3. Upload flow

```
client  → POST {o}/uploads {filename, mime, sizeBytes, sha256, projectId}
  api: permission on target module, storage entitlement, mime allow-list, size ≤ 5 GB
       insert files.upload_sessions → presigned PUT to quarantine/{uploadId}
       (or multipart: 16 MB parts, resumable, for > 100 MB and all mobile photos on poor signal)
client  → PUT to S3
S3 event → GuardDuty Malware Protection scans and tags the object; files worker: verify size + sha256
         → read the scan tag → mime sniff → EXIF (time, GPS)
         → per-org dedupe on sha256 → copy to orgs/… → files.file_objects (status ready)
         → renditions → emit files.object.ready.v1
client  → creates the domain record (photo, revision, attachment) referencing uploadId;
          the record can be created before the file is ready and shows "processing"
```

Malware scanning follows security-licensing/09 §4: Amazon GuardDuty Malware Protection for S3 scans every object on the files bucket and tags it `GuardDutyMalwareScanStatus`. The `files` module reads the tag through its `MalwareScanner` port (`API_FILES_SCANNER=guardduty`), so ClamAV could be swapped in without touching modules. Scanning fails closed:

| Tag | File status | Served |
|---|---|---|
| none yet | `scanning` | no; settled on the next read, `failed` after 15 minutes |
| `NO_THREATS_FOUND` | `ready` | yes, after the move out of quarantine (emits `files.object.ready.v1`) |
| `THREATS_FOUND` | `infected` | never |
| `UNSUPPORTED`, `FAILED`, `ACCESS_DENIED`, anything else | `failed` ("couldn't be scanned") | never |

Infected and unscannable objects are moved by the worker's hourly `files.threat-move` job to `threats/{orgId}/{fileId}` (needs `WORKER_FILES_STORE=s3`; the 30-day delete is a lifecycle rule on `threats/` and on `quarantine/`) and kept for investigation; the uploader and org admins are notified. Clients poll `GET {o}/files/{fileId}` until the status leaves `scanning`; records that reference a file (revisions, attachments) need it `ready`. Using a file that is still `scanning` returns 409 `file.not_ready` (retry); an `infected` or `failed` file returns 422 `file.blocked` (final).
- **Nothing downstream reads a file before `ready`.** That covers download, preview, thumbnails, OCR, tiles, AI indexing, mobile sync, access-link delivery and evidence sealing. All of them read through the `files` module, which refuses any file that isn't `ready`.
- **Every upload path** goes through the same scan: app and mobile uploads, email-in attachments, access-link uploads and imports (Sam 09).
- **On `THREATS_FOUND`**, a security audit event is also written.

**Location metadata (X58):**
- EXIF and location are stripped on upload from credential and ID images only.
- Site photos (defects, diary, photos) keep their EXIF time and GPS, because they are evidence.
- Site photos are served without EXIF location whenever they leave the project, either through an access link or in an export or evidence pack sent outside the project.
- That stripped copy is a rendition, so the original is never altered.

**As built (phase 1):** the scan result is read inline in `complete` and on reads of a `scanning` file; the files worker takes over with a sweep when apps/worker lands. Not yet built: notifying the uploader and admins, the one automatic re-scan of unscannable files, and the security audit event.

## 4. Renditions and drawing processing

- Images: WebP `thumb_256` and `preview_1600` with `sharp`; HEIC converted.
- PDFs and Office docs: first-page thumbnail; Office → PDF via LibreOffice in an isolated container.
- Drawing sets (`drawings` queue): split multi-sheet PDFs, rasterise at high DPI, cut a deep-zoom tile pyramid (256 px WebP), detect sheet references for auto-hyperlinks, extract vector geometry per sheet for takeoff (X30, → `documents.sheet.geometry_ready.v1`); title-block reading is an AI task that writes `ai.ai_suggestions` (Ari F1).
- Text extraction (PDF text layer, OCR fallback) → `ai.extracted_text`, reused by search and AI. Files under `credentials/` skip text extraction, search indexing and embeddings (X58).

## 5. Access

- Every download goes through `GET {o}/files/{fileId}/download`, which checks the caller can see the **record the file belongs to** (via the owning module's resolver), then issues a 5-minute signed URL with `response-content-disposition`. Signed URLs are never stored or emailed.
- Recipients without an account (transmittals, RFI responders, tender invitees) use a `shared.access_links` link (X45, Sam [11](../security-licensing/11-access-links.md)). The landing page checks the link, issues a signed URL and records `opened_at`.
- Downloads of drawings, documents and evidence are written to the activity log (useful in disputes).

## 6. Evidence records

When a claim, schedule, variation, evidential correspondence or transmittal is issued, the `pdf-export` queue renders exactly what the recipient sees, writes PDF + canonical JSON to the evidence bucket, and records hashes in `audit.evidence_records`. Corrections create a new version linked to the old one. Evidence packs are ZIPs with a manifest of hashes and the chain verification result.

## 7. Lifecycle and deletion

| Data | Rule |
|---|---|
| Originals | Intelligent-Tiering; archived projects to Glacier Instant Retrieval (still downloadable) |
| Renditions | regenerable, deleted with the original |
| ID-only images | deleted within 7 days; the "sighted by/on" record stays (X58) |
| Credential images | deleted 12 months after the credential expires or the worker's last project with that builder ends (X58) |
| Soft-deleted files | restorable 30 days, then hard-deleted unless the project is on legal hold |
| Evidence | Object Lock, compliance mode. Each object is locked at write for 10 years from issue, because practical completion may not be known yet. When PC or the occupation certificate date is recorded, or an org extends its retention, the `audit.evidence-retention` job **extends** each object's retain-until date. Object Lock only allows extending, which matches the rule that retention can't be shortened. Nobody can delete evidence before then |
| Cancelled org | read-only export window then deletion per Sam [06 §7](../security-licensing/06-license-enforcement.md) (90 days); evidence kept as required by law |

Storage is summed per org by `billing.usage` (hourly) for plan limits.

**Encryption (X21):** pooled tenants use per-environment customer-managed KMS keys with `org_id` as the encryption context; dedicated cells get their own key. `platform.orgs.kms_key_id` records which key applies. Pooled deletion is a hard delete of rows and objects, with backups ageing out within 35 days; there is no crypto-shredding.

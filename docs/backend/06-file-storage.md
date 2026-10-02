# 06. File storage

**Owner:** Ben · **Status:** Draft v1 · **Last updated:** 2 Oct 2026 · Back to [README](README.md)

Pipeline shape from [data-architecture §4](../architecture/data-architecture.md#4-files-pipeline); security rules from Sam's [03 §4](../security-licensing/03-tenant-isolation.md); evidence rules from Sam's [07 §5](../security-licensing/07-audit-logging.md). Files never pass through API servers.

## 1. Buckets (S3, ap-southeast-2, Block Public Access on, SSE-KMS)

| Bucket | Holds | Settings |
|---|---|---|
| `<env>-files` | originals and renditions under `quarantine/` and `orgs/` | versioning on; Intelligent-Tiering after 90 days; replicated to Melbourne |
| `<env>-evidence` | sealed PDFs + canonical JSON of issued claims, schedules, variations, notices, transmittals; audit chain anchors; archived audit partitions | **Object Lock, compliance mode**; retention per Sam 07 §6 (project close + 7 years default, up to 12); replicated |
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
```

No user-controlled names in keys (the original filename is metadata, returned via `Content-Disposition`). The org prefix supports per-tenant IAM conditions, tenant export, cell moves and deletion.

## 3. Upload flow

```
client  → POST {o}/uploads {filename, mime, sizeBytes, sha256, projectId}
  api: permission on target module, storage entitlement, mime allow-list, size ≤ 5 GB
       insert files.upload_sessions → presigned PUT to quarantine/{uploadId}
       (or multipart: 16 MB parts, resumable, for > 100 MB and all mobile photos on poor signal)
client  → PUT to S3
S3 event → files worker: verify size + sha256 → ClamAV scan → mime sniff → EXIF (time, GPS)
         → per-org dedupe on sha256 → copy to orgs/… → files.file_objects (status ready)
         → renditions → emit files.object.ready.v1
client  → creates the domain record (photo, revision, attachment) referencing uploadId;
          the record can be created before the file is ready and shows "processing"
```

Infected files: status `infected`, object kept in quarantine for 30 days for investigation, uploader and org admins notified, never downloadable.

## 4. Renditions and drawing processing

- Images: WebP `thumb_256` and `preview_1600` with `sharp`; HEIC converted.
- PDFs and Office docs: first-page thumbnail; Office → PDF via LibreOffice in an isolated container.
- Drawing sets (`drawings` queue): split multi-sheet PDFs, rasterise at high DPI, cut a deep-zoom tile pyramid (256 px WebP), detect sheet references for auto-hyperlinks; title-block reading is an AI task that writes `ai.ai_suggestions` (Ari F1).
- Text extraction (PDF text layer, OCR fallback) → `ai.extracted_text`, reused by search and AI.

## 5. Access

- Every download goes through `GET {o}/files/{fileId}/download`, which checks the caller can see the **record the file belongs to** (via the owning module's resolver), then issues a 5-minute signed URL with `response-content-disposition`. Signed URLs are never stored or emailed.
- Transmittal recipients without an account get a tokenised landing link that issues a signed URL and records `opened_at`.
- Downloads of drawings, documents and evidence are written to the activity log (useful in disputes).

## 6. Evidence records

When a claim, schedule, variation, evidential correspondence or transmittal is issued, the `pdf-export` queue renders exactly what the recipient sees, writes PDF + canonical JSON to the evidence bucket, and records hashes in `audit.evidence_records`. Corrections create a new version linked to the old one. Evidence packs are ZIPs with a manifest of hashes and the chain verification result.

## 7. Lifecycle and deletion

| Data | Rule |
|---|---|
| Originals | Intelligent-Tiering; archived projects to Glacier Instant Retrieval (still downloadable) |
| Renditions | regenerable, deleted with the original |
| Soft-deleted files | restorable 30 days, then hard-deleted unless the project is on legal hold |
| Evidence | Object Lock; cannot be deleted by anyone before expiry |
| Cancelled org | read-only export window then deletion per Sam [06 §7](../security-licensing/06-license-enforcement.md) (90 days); evidence kept as required by law |

Storage is summed per org by `billing.usage` (hourly) for plan limits.

**Encryption (X21):** pooled tenants use per-environment customer-managed KMS keys with `org_id` as the encryption context; dedicated cells get their own key. `platform.orgs.kms_key_id` records which key applies. Pooled deletion is a hard delete of rows and objects, with backups ageing out within 35 days; there is no crypto-shredding.

# Stage 4B — System Optimization & Data Ingestion (Insighta Labs+)

This document explains what was implemented for Stage 4B, why each choice was made, and how to verify behavior/performance.

## 1) Query Optimization (performance + DB efficiency)

### What was implemented

- Added/used indexes for frequent filters/sorts in `src/models/profile.js`:
  - Single-field indexes already present (`gender`, `age_group`, `country_id`, `age`, probabilities, `created_at`).
  - Compound indexes added for high-frequency combinations:
    - `{ country_id: 1, gender: 1, age: 1 }`
    - `{ country_id: 1, created_at: -1 }`
    - `{ gender: 1, age: 1 }`
- Added in-memory read cache (TTL + bounded size) in `src/services/queryCacheService.js`.
- Wired cache into:
  - `GET /api/profiles` in `src/controllers/profilesController.js`
  - `GET /api/profiles/search` in `src/controllers/profilesController.js`
- Added cache invalidation after writes in controller:
  - create profile (only on 201)
  - delete profile
  - CSV import success

### Why this approach

- Keeps API unchanged.
- Reduces repeated DB round trips for identical queries.
- Uses practical optimization with low complexity and no extra infrastructure.

### Trade-offs

- In-memory cache is per-process (not shared across multiple API instances).
- Short stale window is possible within TTL; invalidation hooks reduce this.
- Additional indexes improve reads but increase write/index-maintenance cost.

---

## 2) Query Normalization (deterministic canonical keys)

### What was implemented

- Added deterministic normalization utilities in `src/services/queryNormalizationService.js`:
  - `normalizeFilters()`
  - `stableStringify()`
  - `buildCanonicalQueryKey()`
- Canonicalization rules:
  - `gender`, `age_group` → lowercase
  - `country_id` → uppercase
  - age range normalized to `age: { $gte?, $lte? }`
  - probability thresholds normalized to `{ $gte: n }`
  - fixed key ordering and stable stringify
- Applied before cache lookup in both structured list and NL search flows.

### Why this approach

- Deterministic, simple, and safe.
- Avoids cache misses caused by different phrasing / key order for same intent.
- No AI/LLM involved.

### Trade-offs

- Normalization is representation-only; it does not "guess" user meaning.
- Equivalent intent still depends on parser output quality upstream.

---

## 3) CSV Data Ingestion (large-file, chunked, resilient)

### What was implemented

- Added admin-only upload endpoint:
  - `POST /api/profiles/import/csv`
  - Route: `src/routes/profiles.js`
- Added upload middleware with multipart CSV handling:
  - `src/middleware/upload.js`
  - Uses disk temp storage (stream-safe), file type filter, file size limit
- Added ingestion service:
  - `src/services/csvIngestionService.js`
  - Stream parsing (`@fast-csv/parse`)
  - Chunked processing (`CSV_IMPORT_BATCH_SIZE`, default `1000`)
  - Bulk inserts (`insertMany(..., { ordered: false })`)
  - Row-level validation + skip summary
  - Duplicate-name handling aligned with POST idempotency intent
  - Partial failure behavior: inserted rows remain (no rollback)
- Added bounded concurrent upload protection:
  - `CSV_IMPORT_MAX_CONCURRENCY` (default `2`)
  - Returns `429` when active imports exceed capacity
- Added config knobs in `src/config/env.js` + `.env.example`:
  - `CSV_IMPORT_BATCH_SIZE`
  - `CSV_IMPORT_MAX_CONCURRENCY`
  - `CSV_IMPORT_FILE_SIZE_MB`

### Why this approach

- Meets hard constraints: no row-by-row insertion, no full-file memory load.
- Handles bad rows individually without failing whole upload.
- Supports concurrent uploads with back-pressure to protect read path.

### Trade-offs

- Capacity guard currently rejects over-capacity requests (429) instead of queueing them.
- Name duplicate checks use per-batch DB lookups + DB unique index fallback.

---

## 4) Failure & Edge Case Handling

### CSV ingestion behavior

- Missing required fields → skipped (`missing_fields`)
- Invalid age (<0, >150, non-integer) → skipped (`invalid_age`)
- Invalid gender → skipped (`invalid_gender`)
- Invalid country_id format → skipped (`invalid_country_id`)
- Invalid probabilities (not 0..1) → skipped (`invalid_probability`)
- Duplicate name (same idempotency rule) → skipped (`duplicate_name`)
- Malformed CSV row/column mismatch → skipped (`malformed_row`)
- Parse-level malformed CSV → `422 Invalid CSV format`
- Over upload concurrency limit → `429 Too many uploads in progress`
- Upload file cleanup is done in `finally`.

### Response format

The endpoint returns:

```json
{
  "status": "success",
  "total_rows": 50000,
  "inserted": 48231,
  "skipped": 1769,
  "reasons": {
    "duplicate_name": 1203,
    "invalid_age": 312,
    "missing_fields": 254
  }
}
```

---

## 5) Before/After Performance Comparison

Use the same dataset and environment for fair comparison.

| Scenario | Before (ms) | After (ms) | Notes |
|---|---:|---:|---|
| `GET /api/profiles?gender=male&country_id=NG&page=1&limit=10` | _fill_ | _fill_ | index + cache path |
| same request repeated immediately | _fill_ | _fill_ | cache hit expected |
| `GET /api/profiles/search?q=young%20males%20from%20nigeria&page=1&limit=10` | _fill_ | _fill_ | normalized key + cache |

### How to measure

- Run each endpoint 10 times.
- Discard first warm-up call.
- Compare median / p95.
- Confirm query planner uses indexes where applicable (`explain("executionStats")`).

---

## 6) Verification Commands

### Backend checks

```bash
npm test
```

### CSV upload test (admin token required)

```bash
curl -X POST "http://localhost:3000/api/profiles/import/csv" \
  -H "X-API-Version: 1" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -F "file=@./sample_profiles.csv"
```

### Cache key determinism quick check (PowerShell-safe)

```powershell
node --% -e "const { normalizeFilters, buildCanonicalQueryKey } = require('./src/services/queryNormalizationService'); const a={gender:'Female',country_id:'ng',age:{$lte:45,$gte:20}}; const b={country_id:'NG',age:{$gte:20,$lte:45},gender:'female'}; const na=normalizeFilters(a); const nb=normalizeFilters(b); console.log(buildCanonicalQueryKey({filters:na,page:1,limit:10,sort:{created_at:-1}})===buildCanonicalQueryKey({filters:nb,page:1,limit:10,sort:{created_at:-1}}));"
```

---

## 7) Summary of Design Decisions

- Prioritized simple, high-impact optimizations first:
  - deterministic normalization,
  - bounded in-memory cache,
  - index improvements,
  - streaming/batch CSV ingestion.
- Avoided overengineering:
  - no new DB engine,
  - no horizontal scaling assumptions,
  - no distributed cache requirement.
- Focused on correctness under pressure:
  - deterministic behavior,
  - partial-failure-safe ingestion,
  - bounded concurrency for predictable system behavior.

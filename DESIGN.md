# Design Overview
<!-- Keep this doc aligned with the current frontend and backend flow. -->
<!-- Design intent: warm paper backdrop, seafoam accents, serif/sans contrast. -->

## Application Flow
- User signs in with dummy credentials.
- User uploads a CSV file; Papaparse reads rows on the client.
- Rows are normalized and validated with Zod; invalid rows are flagged.
- Claims are grouped into pricing groups using a selectable methodology (MRF standard by default).
- Review offers two working surfaces: pricing-group approvals and an "Edit Claims" tab for granular claim edits.
- User edits individual claims (fields or removals), which revalidates data and recalculates group eligibility.
- User approves pricing groups only after issues are resolved or claims are adjusted as needed.
- Approved groups (valid claims only) are posted to the backend to generate MRF JSON files.
- Backend groups claims, computes averages, writes files to disk, and updates the index.
- The public MRF page fetches and renders the file list for each customer, including multiple submissions over time.

## Grouping Strategy
- Grouping is configurable to reflect common industry review workflows while preserving per-customer separation.
- Supported methodologies:
  - MRF standard: customer + provider + procedure + billing class + service code.
  - Provider + procedure: customer + provider + procedure + billing class.
  - Provider: customer + provider + billing class.
  - Procedure: customer + procedure + billing class.
  - Plan + procedure: customer + plan + procedure + billing class.
- Each pricing group stores counts (total, eligible, denied, invalid) and averages (allowed, billed, paid).
- Sorting follows the active grouping key order so the list stays predictable when the methodology changes.

## Approval Strategy
- Approvals are tracked at the claim level to avoid losing selections when grouping or filters change.
- A group is marked approved only when all eligible claims in that group are approved.
- Switching grouping methods recomputes group approvals from the approved-claims set.
- Clearing approvals resets the approved-claims set and then recalculates group approvals.
- Submitting approved groups generates one MRF file per customer for that submission; repeat submissions append new records.
- Each generated file can include multiple `out_of_network` entries derived from the approved pricing groups.

## Review UI & Filters
<!-- UI favors scannable cards, soft surfaces, and data-dense grids. -->
- The review grid shows aggregated pricing groups; the Edit Claims grid shows all claims with filters for invalid/denied.
- Filters are exposed as focused controls (customer, plan, provider, procedure, billing class, service code, keyword).
- The status bar counts (all/ready/needs attention/approved/unapproved) are recalculated from the filtered dataset.
- Search tokens are derived from group attributes to keep keyword searching fast and consistent.
- Claim edits are handled via row actions and a modal with field-level validation feedback.

## Edit Claims Workflow
- Edit Claims tab surfaces the full claim list with quick filters for invalid or denied entries.
- Row actions provide Edit and Remove; edits update the row, re-run validation, and sync approvals.
- The modal supports granular field changes (dates, identifiers, and financials) with immediate feedback.

## Submission & MRF Output
- Submissions are scoped to approved groups and eligible claims only.
- Each submission returns multiple MRF file records when multiple customers are present.
- Multiple submissions per customer are supported; the index stores a history of generated files.

## Frontend Architecture

### Pages
- `frontend/src/pages/UploadPage.tsx`: Authentication gate, CSV upload, validation feedback.
- `frontend/src/pages/ReviewPage.tsx`: Pricing group approvals, invalid/denied claim edits, MRF submission.
- `frontend/src/pages/MrfListPage.tsx`: List of MRF files and download links, generated each time approved groups are submitted through review criteria.

### State Management (MobX)
- Single store: `frontend/src/stores/appStore.ts`
- Tracks file metadata, parsed claims, validation issues, grouping method, approved claims, pricing group approvals, API status, MRF results, and auth state.
- Actions handle parsing, validation, grouping changes, approvals, claim edits, submission, and MRF list fetches.

### Services & Utilities
- `frontend/src/services/api.ts`: Fetch wrappers for MRF generation and listing.
- `frontend/src/utils/formatters.ts`: Currency and date formatting helpers.

## Backend Architecture

### API Endpoints
- `POST /api/mrf`: Accepts approved claims and generates MRF files.
- `GET /api/mrf`: Lists all customers and their MRF files.
- `GET /api/mrf/:customerId`: Lists MRF files for a specific customer.
- `GET /api/mrf/:customerId/files/:fileName`: Downloads a specific MRF JSON file.

### MRF Generation
- `backend/src/mrf/generator.ts`:
  - Groups claims by customer, then by procedure code and provider/billing class.
  - Computes average allowed and billed amounts per group.
  - Builds `out_of_network` entries aligned with the TiC allowed-amounts schema.
  - Uses a builder-style class to assemble the final MRF object.

### Storage
- `backend/src/mrf/storage.ts` writes MRF JSON files to `backend/data/mrf`.
- `index.json` keeps a lightweight registry of customers and files for fast listing.

## Routing
- `/upload`: CSV upload and validation.
- `/review`: Pricing group approvals and invalid-claim edits.
- `/mrf` and `/mrf/:customerId`: Public MRF listing pages.

## Error Handling
- CSV parsing and validation errors are surfaced in the UI with row-level context.
- Backend returns structured errors for missing claims and missing files.

## Design & Engineering Paradigms
- Single source of truth: the MobX store owns state; UI derives computed views from it.
- Boundary validation: Zod schemas validate inputs on ingest and on every edit.
- Deterministic grouping: pure helper functions build keys, totals, and summaries from claims.
- Separation of concerns: pages handle layout, store handles state, services handle I/O, utils format data.
- Predictable UX: pinned actions, stable sorting, and fixed grid heights reduce cognitive load.
- Explicit error states: errors are surfaced where they occur and do not silently fail.

# EMCIA Certification — Integration contract (draft)

Status: design only; not deployed to production.

## Current source
- Production HTML: `EMCIA_V5_15_16_Cloud_Test.html`
- Experimental branch: `feature/certification-system`
- Isolated UI prototype: `certification-prototype.html`

## Required implementation order
1. Inspect current navigation, user roles, student/teacher models, and Supabase RLS policies.
2. Add the six certification subpages without changing existing navigation behavior.
3. Implement certificate requests, review, approval, immutable issued snapshots, and revocation.
4. Render bilingual Arabic/French A4 certificates with the official `EMCIA_Official_Logo-1.jpg`.
5. Generate PDF from approved immutable snapshots and archive securely.
6. Add verification QR using an opaque random token, not sequential IDs or personal data.
7. Test director/accountant/secretary permissions and cross-device persistence.

## State model
`draft -> submitted -> approved -> issued`
`submitted -> rejected`
`issued -> revoked`

Never delete issued certificates; record revocation reason and audit event.

## Data model (proposed)
- `certificate_types`: id, category, title_ar, title_fr, enabled, requirements_json
- `certificate_templates`: id, type_id, locale, version, layout_json, enabled
- `certificate_requests`: id, subject_kind, subject_id, type_id, requested_by, status, details_json, created_at
- `certificates`: id, request_id, unique_number, immutable_snapshot_json, pdf_storage_path, verification_token_hash, issued_by, issued_at, revoked_at, revocation_reason
- `certificate_audit`: id, request_id, certificate_id, actor_id, action, created_at, metadata_json

## Security constraints
- Authentication and authorization must be enforced server-side with Supabase RLS / trusted functions.
- No client-only role checks for approval, issuance or revocation.
- PDF storage private; issue time-limited signed links to authorized users.
- Public verification exposes only minimal fields and no private identifiers.
- Unique certificate numbers generated transactionally in database.
- No certificate should be treated as a nationally accredited qualification unless separately authorized.

## Acceptance tests
- Existing registration, payments, attendance, reporting continue working.
- Secretary cannot approve or revoke even by calling the backend directly.
- Concurrent issuance does not duplicate certificate numbers.
- Issued PDF is identical when retrieved later.
- Revoked certificate fails verification as valid.
- Arabic RTL and French LTR render correctly in print and PDF.
- Mobile print hides navigation and prints A4 without clipping.

## Important
The prototype is a manual-entry demonstration. It does not connect to Supabase, use real beneficiary records, issue valid certificates, or provide an official PDF archive.

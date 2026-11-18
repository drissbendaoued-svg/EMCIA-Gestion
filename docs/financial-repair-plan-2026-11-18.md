# EMCIA — Financial persistence and discount fixes (staging)

Date: 2026-11-18. Production branch `main` must remain unchanged until tests pass.

## Confirmed code observations
- `addExpense()` appends to `db.x`; `addOther()` appends to `db.oi`; both call `save()`.
- `save()` persists to localStorage and schedules asynchronous cloud sync (550 ms).
- `financialKeys` includes `x` and `oi`; `splitState()` only sends financial arrays when `canFinance()` is true (director/accountant).
- `joinState()` restores empty financial arrays for other roles, even when they have locally entered records.
- A failed `flushCloud()` sets `blocked=true` and leaves a local-only pending change. A later login reloads cloud state, potentially obscuring that change.
- `activeDiscount()` treats bearer `half` as 50/50 regardless of the teacher rate.

## Required safe repair
1. Confirm intended rights for secretary-created expenses and other income. Never bypass financial authorization on the client alone. Implement an authorized server-side append/record RPC with audit log, or restrict entry to authorized roles and show an explicit warning.
2. Save operations must have durable server acknowledgment before displaying “saved”; retain a recoverable unsynced local journal and do not silently overwrite it during login.
3. Add a visible pending/error/saved state and reconciliation on reload; prevent duplicate submissions via stable operation IDs.
4. Shared discounts must allocate by teacher rate `g.r`; custom allocations must sum exactly to the discount. Keep historical payment allocations immutable until approved migration.
5. Teacher reports should show both teacher-borne and institute-borne discounts.

## Acceptance tests
- Create 100 DH other income and 40 DH expense, wait for cloud confirmation, log out/in, check exact IDs and totals.
- Repeat on a second authorized account and on a secretary account; confirm either successful authorized save or clear rejection, never apparent success followed by loss.
- Simulate offline, HTTP 409, expired token, tab close and concurrent edits; verify recoverable unsynced operations.
- Test 150 DH base / 15 DH shared discount at teacher rates 50%, 60%, 65%; verify shares sum to 135 DH and discount shares sum to 15 DH.
- Test teacher-only, institute-only, custom, partial payments, sessions, and rounding to cent.
- Compare before/after November 2026 totals on an anonymized backup without mutating production.

Status: investigation and test specification only. No production changes or claims of completed repair.


## Authorized role policy — confirmed 2026-11-18
- Both secretaries may create, edit, delete and durably save expenses and other income, with actor/time audit history.
- Both secretaries may view comprehensive reports during the correction phase.
- Budget Management and Financial Analysis remain exclusively for director/accountant.
- Access restrictions must be enforced server-side, not just by hiding navigation.

## Verified live database cause (read-only inspection)
The current `public.emcia_save_state_v2` RPC explicitly rejects non-director/non-accountant requests containing `p_financial`. The client only includes `financialKeys=['tp','adj','x','oi','sv','obligations']` when `canFinance()` is true. Consequently secretary edits to `db.x` and `db.oi` can appear locally but are omitted from the cloud write, and are lost from the loaded view after a new session. This is a confirmed authorization/persistence mismatch.

## Safe implementation boundary
Do NOT simply permit secretaries to overwrite the whole financial JSON: that would grant budget, settlement and other restricted write access. Preferred fix: server-side authorized append/update/delete operations scoped to `x` and `oi`, with immutable actor/time audit entries and stable operation IDs, while preserving financial-state revision checks. A role-specific read projection may expose reports without granting financial-state write. Test with secretary, accountant and director accounts, then deploy after backup and approval.

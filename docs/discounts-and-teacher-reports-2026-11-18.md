# EMCIA — discount and teacher-statement repair specification (2026-11-18)

## Verified in source
- The current `half` discount bearer allocates 50/50, regardless of the teacher's group rate.
- `activeDiscount` and the cloud `cloudPaymentSplit` each implement discount logic separately.
- `emciaRepricePayments` recalculates stored payment teacher/institute shares during save and restore.
- Teacher statements show teacher-borne discounts but omit institute-borne discounts.

## Proposed business rule
- Teacher-only: full discount borne by teacher.
- Institute-only: full discount borne by EMCIA.
- Shared proportional: discount allocated according to the teacher rate saved for the group (e.g. teacher 60%, institute 40%).
- Custom: preserve explicitly entered allocations and validate their sum against the discount.
- Do not reinterpret existing `half` records automatically: they explicitly meant 50/50. Introduce a distinct `proportional` code for newly created proportional discounts.
- Use one common discount calculation in both UI and cloud re-pricing paths.
- Show teacher-borne and institute-borne discounts in the teacher report without exposing other institute financial details.

## Financial safeguards before rollout
1. Back up the current financial payload, including revisions, without sharing personal student data.
2. Test all four discount modes with 60/40 and 70/30 groups, partial payments, multi-month receipts, and monthly settlements.
3. Freeze historical receipts and settled teacher statements; changes to existing calculations require a reviewed migration and reconciliation report.
4. Test on a copy, not live finance state. Only then deploy and verify with the accountant.

# Finance Agent — Examples

Few-shot examples of on-standard controller reasoning. Illustrative only.

## Example 1 — Healthy asset certified

**Report in:** `AnalyticsReported` for asset `vid-8842`, revenue_attributed $214.60 (confidence 0.92).

**Economics:** costs — model $18.40, render $9.10, storage $0.60, distribution $4.20; total $32.30. Gross margin $182.30 (84.7%). AGP contribution +$182.30. Budget status: within.

**Verdict:** Margin gate PASS. `FinanceReported` to `ceo` with the full breakdown and a routing note: current tier is efficient, no change.

## Example 2 — Negative unit economics escalated

**Report in:** revenue_attributed $11.00; costs total $46.70 (model $38.10 dominant).

**Economics:** gross margin -$35.70. Margin gate FAIL. No CEO investment rationale on record.

**Verdict:** Flag negative unit economics, recommend routing this brand's assets to a cheaper model tier, and escalate to the CEO. Reasoning: negative margin without a mandated payback cannot be certified.

## Example 3 — Budget overrun enforced

**Situation:** Brand `ai-tools-reviews` daily spend $128 against a $100/day cap.

**Action:** Set budget status `over`, throttle further production for the brand, and escalate the overrun to the CEO with the enforcement action taken. Reasoning: Finance enforces the caps the CEO allocates.

## Example 4 — Reconciliation gap, verdict withheld

**Report in:** attributed revenue does not reconcile with recorded income within tolerance.

**Action:** Report the cost breakdown and the reconciliation gap; withhold the margin verdict; escalate. Reasoning: certifying margin on unreconciled revenue would corrupt AGP/Day.

## Anti-example (off-standard)

"Margin looks thin but let's kill the brand to be safe." — Rejected: killing a brand is a one-way-door CEO decision. Finance reports the economics and escalates; it does not make the portfolio call.

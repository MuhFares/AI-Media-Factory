# Morroway Business MVP V1 — Product Contract

**Date:** 2026-09-24. **Mode:** PLATFORM_VALIDATION_MODE.
Authority: NOT_GRANTED / NOT_GRANTED / NOT_PUBLISHED (unchanged by this program).

## Product claim

An Owner can operate ONE Morroway YouTube Short content cycle from the AMF
product UI without PowerShell, direct database access, scripts, workflow IDs,
or developer intervention during the normal journey.

## Golden Path (all in-product)

Content → Create Content (title, objective, optional topic/seed) → Content
Item (Idea/Plan, Brief, Script, Visual/Media, QA, Approval, Publishing
readiness, Analytics, Learning) → link existing workflow → Decision Center
only when Owner decision required → return to Content Item.

## Canonical entities

content_items (content_id, project, channel=youtube, format=short, title,
objective, topic/notes/constraints, seed/linked workflow/experiment refs).
Status DERIVED from linked lifecycle + learning chain (IDEA…COMPLETED);
workflows, artifacts, approvals, publications, learning stay canonical.

## Architecture linkage

ContentStore (database) → /control/content* (Node, auth-enforced) →
/api/content* (Python facade, session) → Content workspace views (app.js).
Workflow engine, artifact system, Decision Center, learning loop reused
unchanged. Creation/linking never starts execution, decides, or grants.

## Supported format

YouTube Short for Morroway only. Channel display is a project default
label; no channel registry exists yet.

## Limitations (honest)

- Content creation does NOT start execution; governed runs still begin
  through the existing authorized Command Room path, then link by workflow ID.
- No public upload path exercised; publishing section is readiness-only.
- Analytics shows runs/costs plus honest not-yet-available; audience
  metrics appear only when measurement exists.
- Learning shows only recorded evidence; nothing is inferred.
- One Owner, localhost, manual supervision; no RBAC, notifications, calendar.
- M4 measurement remains independent and pending.

## Authority boundaries

Decision Center is the sole actionability truth. Readiness never grants
publication authority. No workflow/command started by content journeys.
All content mutations require Owner session; Node enforces Bearer server-side.

## Proof evidence

DB: content-domain 3/3. API: content-api 2/2 (auth, validation, linkage,
no execution). UI: content-ui 4/4. Walkthrough (live Morroway): create →
IDEA → link validation workflow → READY_TO_PUBLISH with 108 artifacts,
lifecycle, and readiness; decisions 0/1/14 and queue 0/0 undisturbed.
V1.1 + Program 1 regressions green.

# Order Recovery Desk demo boundaries

This repository contains synthetic data only. Work only on the scoped request in
`REQUEST.md`. Do not contact external systems or add dependencies.

- This is a local, synthetic order demonstration, not a commerce service.
- Do not claim revenue gains or time savings from this demonstration.
- Only `src/app.mjs`, `public/index.html`, `public/app.mjs`, and
  `tests/app.test.mjs` may change.
- Do not edit agent profiles, instructions, fixtures, CSS, package manifests,
  `REQUEST.md`, or `.demo/`. The demo controller owns `.demo/`.
- Do not commit, push, merge, deploy, install packages, or invoke other agents.
- The human-owned acceptance suite is outside this repository.
- The controller runs the tests. Never claim tests passed unless you have read
  the corresponding execution evidence.
- Use built-in Node.js APIs, readable JavaScript, and native HTML controls.
- Surface request failures in the UI. Preserve existing behavior.
- The local in-memory order store is intentional. Do not imply durability,
  distributed safety, real payment processing, or production readiness.
- Respond in Korean. Distinguish observations, recommendations, and approvals.

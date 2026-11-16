# Panthiya — Build log

One row per completed task. Kept by the `update-build-log` Kiro hook. The Kiro write-up and both
hackathon submissions are assembled from this log, so a task is not finished until its row exists.

Honesty rule: if something does not work, or a rule could not be enforced in code, it is written
here as such. A log that only records successes is useless for the write-up and for the next bug.

| Date | Task | What was built | Problem → how it was solved |
|---|---|---|---|
| 2026-11-16 | M0 · 0.1 | `requirements.md` (13 requirements, EARS criteria, traceability table mapping all 36 red-team cases to criteria) | none |
| 2026-11-16 | M0 · 0.1 | `design.md` — architecture, trust model, the 8-table data model with keys and GSIs, the policyCheck algorithm, cost model | Bedrock attaches action groups to an agent *version*, not a session, so requirement 1.5 cannot be met by configuration alone → met in code and IAM instead: each action Lambda refuses any other role as its first statement, and the Student action Lambda is given no DynamoDB permissions at all. Recorded as a `ponytail:` ceiling comment in design §3.3 |
| 2026-11-16 | M0 · 0.1 | `tasks.md` — M0–M7 plan, each task mapped to requirement IDs, human-gated tasks marked `[human]` | none |
| 2026-11-16 | M0 · 0.2 | Folder skeleton per `.kiro/steering/structure.md` | none |
| 2026-11-16 | M0 · 0.3–0.6 | Hello page: `index.html`, `assets/styles.css`, `assets/app.js`, `assets/favicon.svg`, `i18n/{si,ta,en}.json` | The page is entirely i18n-driven, so with JavaScript disabled it would render blank → added a `<noscript>` summary. Requirement 12.2 (no literal UI text in markup) is kept for everything the app actually uses |
| 2026-11-16 | M0 · 0.4 | Exercise-book theme: ruled lines and the red margin drawn with CSS gradients, CSS-only rotated stamps for Paid / Absent / Needs approval, no images to download | Contrast had to be verified by hand for five ink colours on `#FBF7EE`; the measured ratios are written next to each token in `styles.css` so a future colour tweak cannot silently break requirement 12.5 |
| 2026-11-16 | M0 · 0.7–0.8 | `amplify.yml` (no build step, asserts the four content files exist before deploying) and `customHttp.yml` (CSP from `default-src 'none'`, HSTS, nosniff, Referrer-Policy, Permissions-Policy) | A strict CSP rules out a font CDN for Sinhala and Tamil → device font stack now, self-hosted Noto subset in M6 (task 6.6) |
| 2026-11-16 | M0 · 0.9–0.12 | `README.md` with the Mermaid diagram, cost table and security/privacy section; MIT `LICENSE`; `.gitignore` that explicitly never ignores `.kiro/`; this log; two Kiro hooks | none |
| 2026-11-16 | M0 · tests | `tests/unit/frontend.test.mjs` and `package.json` — checks the three language packs have identical key sets, every `data-i18n` key in the markup resolves in all three, the markup has no inline style, script or event handler (so the strict CSP holds), no script writes `innerHTML`, and the design tokens meet 4.5:1 / 3:1 contrast read straight from `styles.css`. 6 tests, no dependencies | The innerHTML check first failed on `app.js` — it was matching the word inside the comment that *forbids* innerHTML. Fixed by stripping comments before scanning, rather than by rewording the comment. `node --test tests/unit` also fails on Node 24 for Windows; the glob form works, so it is wrapped in `npm test` and referenced from the hook and README |
| 2026-11-16 | M0 · 0.3–0.6 | Verified in a real browser at 1536 px: all three languages render, `document.title` and `lang` follow the switcher, choice persists across reload, skip link appears on first Tab with a visible focus ring, console clean | **Bug found and fixed:** `--font-body` listed `"Noto Sans Sinhala"` first, so Latin text rendered in that font's Latin glyphs and looked wrongly tracked. Font fallback is per character, so the Latin face must lead and the Indic faces sit behind it. Reordered the stack and left a comment saying why, since the obvious "put the Sinhala font first" instinct is the wrong one |

## Decisions still open

| # | Decision | Needed by |
|---|---|---|
| 1 | Public GitHub repo URL (placeholder `github.com/<your-user>/panthiya` is in README and `index.html`) | M0 go-live |
| 2 | Region: `ap-south-1` if Bedrock Managed Agents and the model are available there, else `us-east-1` | before the first deploy |
| 3 | Model choice after the day-1 Sinhala test (`scripts/test-sinhala.mjs`, task 1.1) | before M1 merge |
| 4 | Native review of the Sinhala and Tamil UI strings written in M0 | before M6 |
| 5 | Nov 18 — whether the Bedrock challenge rules permit a parallel Kiroween submission | Nov 18 |

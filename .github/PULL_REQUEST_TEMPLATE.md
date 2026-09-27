<!--
  Instructions for agents and contributors:
  - Keep the sections below filled in; do not delete them.
  - Remove any checklist items or subsection comments that are genuinely not applicable, but state why in the PR description.
  - Non-API PRs (e.g. dependency bumps, config changes, refactors with no endpoint/behavior impact) may skip request/response evidence, but must still explain why in the API Verification section.
  - Link the governing issue in the Linked issue section with a closing keyword. Do not leave it blank.
  - For PRs targeting `release`, use the release template instead:
    `.github/PULL_REQUEST_TEMPLATE/release.md`
-->

## Summary

-

## Linked issue

<!--
  Use a GitHub closing keyword so the issue timeline links this PR and the issue
  closes on merge, for example:

    Closes #123

  Accepted keywords include Closes, Fixes, and Resolves. For a stacked PR whose
  base is another PR, the closing reference registers once the base reaches the
  default branch; a plain mention such as `Part of #123` links the issue immediately.
  When this PR resolves no issue, write "No linked issue" and say why.
-->

Closes #

## Risk Rating

> **Review effort guide for humans. Agents must fill in the impact badge and rationale before requesting review.**

### Overall risk

Pick **one** badge and delete the others:

- ![low](https://img.shields.io/badge/risk-low-green) — isolated change, limited files, no auth/security surface, no schema/env changes, well-covered by tests.
- ![medium](https://img.shields.io/badge/risk-medium-orange) — touches shared modules/middleware, adds a dependency, changes request/response shapes, or involves user input/auth but follows existing patterns.
- ![high](https://img.shields.io/badge/risk-high-red) — broad refactor, security-sensitive code, auth/token handling, DB schema migration, rate limiting/abuse surface, or changes that could break core API flows.

### Rationale

- **Scope**:
- **Blast radius**:
- **Data/schema changes**:
- **Auth/security concerns**:
- **Dependencies / external services**:

### Security concerns

- None

## API Verification

> **Agents must provide proof that the implementation works against the real server for endpoint/behavior changes. Attach curl output, supertest results, or a link to a short Loom/Cloudinary clip below. Contributors may use the same section.**

### Does this PR change API behavior?

- [ ] Yes — endpoints, request/response shapes, or status codes changed (evidence required below).
- [ ] No — only non-API code/config/test changes (explain why evidence is skipped).

### How to capture evidence

1. Run the server: `pnpm start` (or `pnpm test` for automated coverage).
2. Exercise the endpoint(s) with `curl` against `http://localhost:<port>` (or via supertest in tests).
3. Capture:
   - **Request/response pairs** — the exact `curl` command and the returned status code + body (at least the happy path and one error case).
   - **Test output** — the relevant `pnpm test` run showing the new tests passing.
4. Attach evidence **directly to the PR body** by dragging the files into the GitHub text area.
5. For terminal-only workflows, create a public gist and embed the raw image URLs:
   ```bash
   gh gist create pr-assets/<branch-name>/*.png --public --desc "API evidence for <branch-name>"
   ```
   Open the created gist, click each image, and copy its **raw URL** (`https://gist.githubusercontent.com/<user>/<gist-id>/raw/<filename>`). Embed it as:
   ```markdown
   ![alt text](https://gist.githubusercontent.com/<user>/<gist-id>/raw/healthcheck_200.png)
   ```
   Do not upload `.env` files, logs, build artifacts, or screenshots containing secrets/PII.

### Attachments

- [ ] curl request/response pairs attached
- [ ] Test output / screen recording attached (preferred for multi-step flows)
- [ ] If the change is invisible, explain why no evidence is needed and what was verified instead.

#### Example request/response

```bash
curl -s -w "\nHTTP %{http_code}\n" http://localhost:3000/api/worlds/123
```

```json
{
  "id": "123",
  "name": "Example World"
}
```

```
HTTP 200
```

### Verification checklist

- [ ] `pnpm test` passes.
- [ ] `pnpm lint` is clean.
- [ ] `pnpm start` boots without errors.
- [ ] Endpoints manually exercised via curl (or covered by supertest/integration tests).
- [ ] No new errors in server logs (`tslog.log`).
- [ ] DB migrations/schema changes verified against a fresh or migrated database.
- [ ] Feature flag / env-var behavior verified if the PR touches a flagged feature.

## Test Plan

-

## Deployment / Release Notes

-

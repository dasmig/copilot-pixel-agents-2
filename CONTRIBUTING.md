# Contributing

## Setup

See [README → Desenvolvimento local](README.md#desenvolvimento-local) for cloning, install
and build instructions, and the full table of `npm` scripts.

## Workflow

- This repo has a single long-lived branch, `master`. Create a feature/fix branch off it
  (`git checkout -b feat/short-description` or `fix/short-description`) and open a pull
  request — don't push directly to `master`.
- Every push and PR runs `.github/workflows/ci.yml`: install, `typecheck`, `test`,
  `npm audit --omit=dev --audit-level=high` and a full package (`.vsix`) build. A PR
  should not be merged with a red CI run.
- Before opening a PR, run locally from the repo root:
  ```bash
  npm run typecheck
  npm test
  ```
- Commit messages follow a loose Conventional Commits style seen throughout the history:
  `feat: …`, `fix: …`, `fix(scope): …`, `chore: …`, `docs: …`. Keep the subject line short
  and imperative; use the body to explain *why*, not just *what*, especially for bug fixes
  (see `git log` for examples worth following).

## Versioning and releases

This project follows [SemVer](https://semver.org/). A release is: bump `version` in
`package.json`, update `CHANGELOG.md`, merge to `master`, then tag:

```bash
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

Pushing the tag triggers `.github/workflows/release.yml`, which refuses to run if the tag
doesn't match `package.json`'s version, then builds, tests, packages and publishes a
GitHub Release with the `.vsix` attached (and to the Marketplace, if the `VSCE_PAT` secret
is configured — see `.github/PUBLISHING.md`). Don't hand-craft `.vsix` files into the repo
or skip the tag when bumping a released version — untagged/undocumented version bumps are
exactly the gap that made 0.4.5–0.4.9 unrecoverable from git history (see the note at the
top of `CHANGELOG.md`).

## Code conventions

- TypeScript `strict` mode throughout; both `tsconfig.json` (extension) and
  `webview-ui`'s `npm run typecheck` must stay clean — that command covers every file
  under `webview-ui/src`, not a hand-picked subset.
- The hooks HTTP handler (`src/hookHttp.ts`, `src/hookPayload.ts`) is deliberately
  allowlist-based: `normalizeHookEvent` never spreads incoming JSON into application
  state. If you add a field, validate and allowlist it explicitly — don't widen this to
  pass arbitrary objects through.
- Task detail capture (`src/taskDetails.ts`) is opt-in and best-effort redacted. Changes
  there should keep the "off by default, purge on disable" behavior described in
  `SECURITY.md`.
- New behavior in `webview-ui/src/engine.ts`, `sprites.ts`, `seating.ts` or
  `isometric.ts` should come with a test in `webview-ui/tests/` (they bundle the actual
  `.ts` sources in-memory via esbuild — see existing tests for the pattern).

## Reporting bugs / requesting features

Use the issue templates under `.github/ISSUE_TEMPLATE/`. For a suspected security issue,
follow `SECURITY.md` instead of opening a public issue.

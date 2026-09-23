# Publishing This Fork

This repository distributes its own VSIX through [GitHub Releases](https://github.com/dasmig/copilot-pixel-agents-2/releases). The Marketplace listing for `cl-oliveira.copilot-pixel-agents` belongs to the upstream publisher; a GitHub Release on this fork does not update that listing.

## Release Workflow

1. Enable GitHub Actions on the fork, if GitHub has disabled workflows inherited from upstream. Review [release.yml](workflows/release.yml) before enabling it.
2. On `master`, update the root and `webview-ui` package manifests and lockfiles to the same version. Update [README.md](../README.md) and [CHANGELOG.md](../CHANGELOG.md).
3. Run `npm run typecheck`, `npm test`, `npm run build:webview`, `npm run build`, `npm run test:package`, and `npm run package`. Check that the VSIX contains the new README, registered assets, and no private files.
4. Merge the version change to `master`, then tag that merged commit. For version 0.8.0:

   ```bash
   git tag -a v0.8.0 -m "v0.8.0"
   git push origin v0.8.0
   ```

The release workflow verifies that the tag matches `package.json`, installs dependencies, typechecks, tests, builds, checks packaged assets, creates a VSIX, and uploads it to a GitHub Release. If Actions is unavailable, create a GitHub Release manually from the verified tag and attach the locally built VSIX; do not tag an unmerged feature branch.

## Marketplace Publishing

Only the owner of the `cl-oliveira` publisher can publish to the existing Marketplace listing. **Do not add a Marketplace PAT to this fork's `VSCE_PAT` secret without the publisher's permission.** The release workflow skips the Marketplace step when that secret is absent.

Publishing under a different Marketplace publisher requires changing `publisher` in `package.json`, updating the extension identity and installation guidance, and arranging new publisher credentials as a separate release decision. Never put PATs in source, commits, documentation, or command output.

To install the fork's build without Marketplace access, choose **Extensions: Install from VSIX...** in VS Code and select the artifact from this fork's GitHub Release.

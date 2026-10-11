# Runtessa vscode

VS Code tenant workspace extension. Part of the private [Runtessa organization](https://github.com/Runtessa).

## Development workspace

Use the integration checkout to preserve shared-package paths, locks and cross-service tests:

```sh
git clone --recurse-submodules https://github.com/Runtessa/platform.git
cd platform
```

This repository mounts at `src/ide-vscode`. Follow the [platform setup and checks](https://github.com/Runtessa/platform/blob/main/CONTRIBUTING.md).
The current light/dark IDE and syntax colors are preserved.

## History and license

History was extracted from `src/ide-vscode` at platform commit `c25521a53a10b9f255bbfa5c05607fbde1330d69` without squashing.
Author identities, dates and commit messages are preserved; extracted commit IDs differ because paths are rooted here.
The complete original commit graph, all historical paths, branches, issues and pull requests remain in `Runtessa/platform`.
Apache-2.0; retain LICENSE, NOTICE and third-party notices.

---

# IDPCore Tenant Studio

VS Code extension for working on an `ideNew` tenant outside the browser IDE.

## What it does
- pulls the full tenant into a real local folder
- shows modules, models, UI, shared packages, and ACL in a dedicated explorer view
- pushes file edits back to `ideNew`
- supports creating modules, models, UI packages, shared projects, shared files, and ACL files from VS Code
- opens tenant UI preview inside VS Code through the same `preview.html` runtime contract used by the browser IDE
- runs Codex directly inside the pulled tenant workspace

## Required configuration
- `idpcore.coreApiBase`
- `idpcore.tenantHost`
- browser sign-in through `IDPCore: Sign In to ideNew`

## Preview configuration
- `idpcore.previewPort`: preview runtime port, default `3000`
- `idpcore.previewRoute`: initial preview route, default `/`
- `idpcore.previewStage`: `draft` or `published`

## Useful commands
- `IDPCore: Configure Connection`
- `IDPCore: Sign In to ideNew`
- `IDPCore: Pull Tenant Workspace`
- `IDPCore: Push Active File`
- `IDPCore: Push All Changes`
- `IDPCore: Open Tenant Preview`
- `IDPCore: Open Codex Terminal`
- `IDPCore: Run Codex Prompt`

## Debugging the extension
Manual local testing before packaging VSIX:
- from `src/ide-vscode`: `npm run dev:host`
- from repo root: `npm run vscode:host`

This opens a separate Extension Development Host window with the extension loaded. It is the right way to try the UI and commands manually.

Automated test harness:
- `npm run test`

This is not a manual preview flow. It launches a temporary test host, runs tests, then exits.

VS Code launch configurations from the monorepo root:
- `Launch VS Code Extension (IDPCore)`
- `Test VS Code Extension (IDPCore)`

They rely on root workspace tasks:
- `build: ide-vscode`
- `watch: ide-vscode`
- `test: ide-vscode`

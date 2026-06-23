# Release process

This document describes the manual checklist for Slopflow's first npm release. It is release documentation only; following this checklist locally should not publish until the explicit publish step.

## Release boundary

The npm package distributes the Slopflow CLI only. It is expected to contain:

- `dist/cli.js`
- `README.md`
- `LICENSE`
- `package.json`

Agent skills are distributed separately from the repository through Vercel Skills:

```bash
npx skills add aivv73/slopflow --skill slopflow
npx skills add aivv73/slopflow --skill slopflow-live
```

The npm package must not install skills into Claude, Pi, Cursor, or other agent harness directories.

## Versioning policy for 0.x

Slopflow uses `0.x` versions while the CLI workflow is still stabilizing.

- Patch releases (`0.1.1`) are for fixes, documentation, and packaging polish that preserve the current command contracts.
- Minor releases (`0.2.0`) may add commands, artifacts, or workflow gates, and may change unstable behavior with release notes.
- Breaking changes should be avoided when practical, but `0.x` releases may still revise the CLI-runbook model before a future `1.0.0` stability commitment.

## Pre-release checks

From a clean working copy, install dependencies and run the full validation path:

```bash
npm ci
npm run ci
npm pack --dry-run
npm publish --dry-run
```

For the local non-publishing release check used by maintainers and CI-adjacent validation, run:

```bash
npm run release:check
```

`release:check` intentionally avoids `npm publish --dry-run` so it does not require npm publishing credentials. Run `npm publish --dry-run` manually with an authenticated npm account before publishing.

## Publish command

After the checks pass and the package contents look correct, publish manually:

```bash
npm publish --access public
```

Do not publish from an agent session unless the user explicitly asks for publishing and npm credentials/access have been confirmed.

## Post-publish checks

After publishing, verify the published CLI can be installed and invoked from a temporary directory:

```bash
tmp=$(mktemp -d)
npm install --prefix "$tmp" slopflow
"$tmp/node_modules/.bin/slopflow" --help
rm -rf "$tmp"
```

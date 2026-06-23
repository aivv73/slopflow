# Slopflow

Turn AI slop into scoped, tested, reviewed, reversible changes.

Slopflow is a local CLI-runbook for controlled issue execution by AI coding agents.

The first vertical slice provides:

```bash
slopflow init
slopflow status
slopflow start <issue-id>
slopflow pause <issue-id> --reason <text>
slopflow resume <issue-id>
slopflow cancel <issue-id> --reason <text>
slopflow test <issue-id> --name <gate> -- <command...>
slopflow review <issue-id>
slopflow complete <issue-id>
```

## Usage

Slopflow requires Node.js 24 or newer.

Initialize Slopflow machine config in a Jujutsu-backed GitHub repo:

```bash
slopflow init
```

Inspect current Slopflow state:

```bash
slopflow status
```

Bootstrap controlled work for an existing issue:

```bash
slopflow start 2
```

`start` creates real bootstrap artifacts under `.slopflow/work/<issue-id>/`:

```text
issue.md
contract.md
status.json
goal-prompt.md
next-steps.md
```

It does not create placeholder evidence, review, or completion files.

Pause, resume, or cancel local issue work without running gates or mutating Jujutsu history:

```bash
slopflow pause 2 --reason "waiting for external review"
slopflow resume 2
slopflow cancel 2 --reason "superseded by another issue"
```

Lifecycle commands preserve the work directory and record local status only. They do not push, close issues, publish, delete evidence, or abandon Jujutsu changes.

Capture command-based quality evidence for started issue work:

```bash
slopflow test 2 --name unit -- npm test
slopflow test 2 --name typecheck -- npm run build
```

`test` writes structured evidence and raw logs under `.slopflow/work/<issue-id>/evidence/`, then returns the wrapped command's exit code.

Prepare a review packet and validate reviewer verdict state:

```bash
slopflow review 2
```

`review` writes `.slopflow/work/<issue-id>/review-packet.md` but never creates `review.json`. A separate human or agent reviewer must write the verdict.

Mark issue work locally complete after evidence and reviewer gates pass:

```bash
slopflow complete 2
```

`complete` generates `completion-note.md` when missing, preserves an existing note, updates local `status.json`, and never publishes, pushes, merges, opens PRs, or closes issues.

## Agent skills

For a new project, install and run the setup skill before the Slopflow execution skill. It records the repository's issue tracker, triage labels, and domain-documentation layout so later engineering skills have the local context they expect:

```bash
npx skills add aivv73/slopflow --skill setup-slopflow-skills
```

If your agent runtime supports Claude-compatible skill interpolation, use the live setup variant instead:

```bash
npx skills add aivv73/slopflow --skill setup-slopflow-skills-live
```

The setup skills create OKF-compatible `docs/agents/*.md` concept documents and update the repo's `AGENTS.md` or `CLAUDE.md` instructions. They are adapted from Matt Pocock's engineering skills (https://github.com/mattpocock/skills/) for Slopflow onboarding. Run one of them first in a newly onboarded project, then initialize Slopflow and use the execution skill.

Install the portable Slopflow skill:

```bash
npx skills add aivv73/slopflow --skill slopflow
```

Install the live-context Slopflow skill for Claude Code or Pi with `pi-skill-interpolation`:

```bash
npx skills add aivv73/slopflow --skill slopflow-live
```

The portable skills do not execute shell commands during rendering. The live skills use Claude-compatible read-only shell interpolation to inject setup or Slopflow context.

Agent skills are installed separately through Vercel Skills. The Slopflow npm package distributes the CLI and does not install skills into Claude, Pi, Cursor, or other agent harness directories.

## Install

Slopflow is published on npm: https://www.npmjs.com/package/slopflow

Install the CLI globally:

```bash
npm install -g slopflow
```

Then run:

```bash
slopflow --help
slopflow status
```

For local development from a clone:

```bash
npm install
npm run build
npm link
slopflow status
```

To remove the local link later:

```bash
npm unlink -g slopflow
```

## Development

Slopflow uses TypeScript and npm for the CLI implementation. Use Node.js 24 or newer.

Install dependencies:

```bash
npm install
```

Run the test suite:

```bash
npm test
```

Build the CLI:

```bash
npm run build
```

Check the npm package contents:

```bash
npm run pack:check
```

Run the install smoke test:

```bash
npm run pack:smoke
```

Run full local CI, matching the GitHub Actions workflow:

```bash
npm run ci
```

GitHub Actions runs the same `npm run ci` package checks on pushes to `main` and pull requests.

Check release readiness without publishing:

```bash
npm run release:check
```

See [docs/release.md](docs/release.md) for the manual npm release checklist.

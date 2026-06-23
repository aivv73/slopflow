# Slopflow

Turn AI slop into scoped, tested, reviewed, reversible changes.

Slopflow is a local CLI-runbook for controlled issue execution by AI coding agents.

The first vertical slice provides:

```bash
slopflow init
slopflow status
slopflow start <issue-id>
slopflow test <issue-id> --name <gate> -- <command...>
slopflow review <issue-id>
slopflow complete <issue-id>
```

## Usage

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

Install the portable Slopflow skill:

```bash
npx skills add aivv73/slopflow --skill slopflow
```

Install the live-context Slopflow skill for Claude Code or Pi with `pi-skill-interpolation`:

```bash
npx skills add aivv73/slopflow --skill slopflow-live
```

The portable skill does not execute shell commands during rendering. The live skill uses Claude-compatible read-only shell interpolation to inject current Slopflow and Jujutsu context.

## Development

Slopflow uses TypeScript and npm for the CLI implementation.

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

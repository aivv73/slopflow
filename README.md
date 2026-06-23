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

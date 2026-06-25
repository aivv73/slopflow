---
name: slopflow
description: Follow Slopflow's controlled issue execution workflow for AI coding agents: start scoped issue work, capture test evidence, prepare review packets, respect reviewer verdicts, and complete only through local gates.
---

# Slopflow

Use this skill when working in a repository that uses Slopflow, or when the user asks you to implement an existing issue through Slopflow.

For a newly onboarded project, run the `setup-slopflow-skills` skill first. It records the repository's issue tracker, triage label vocabulary, and domain documentation layout in `docs/agents/*.md` before this execution workflow starts issue work.

## What it does

- Keeps issue execution scoped to Slopflow's local artifacts and gates.
- Starts issue work with `slopflow start <issue-id>`.
- Records test evidence with `slopflow test <issue-id> --name <gate> -- <command...>`.
- Coordinates parallel agent attempts through artifacts, isolated execution workspaces, comparison, selection, and artifact-only promotion without controlling agent processes.
- Supports local lifecycle state with `pause`, `resume`, and `cancel` without controlling an agent runtime.
- Prepares review packets with `slopflow review <issue-id>` without self-approval.
- Completes work only through `slopflow complete <issue-id>` after test evidence and reviewer approval.

## Core rule

The Slopflow CLI output and `.slopflow/work/<issue-id>/` artifacts are canonical. Do not manually invent, rewrite, or bypass Slopflow artifacts when a CLI command exists for that step.

Slopflow is a CLI-runbook, not an agent runtime. Agent attempts are Slopflow-owned artifacts for coordinating independent work across a canonical repository and isolated execution workspaces. Use only attempt commands exposed by the installed CLI.

## Workflow

1. Inspect current state:

   ```bash
   slopflow status
   ```

2. If this is a new project and `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, or `docs/agents/domain.md` are missing, pause and ask to run `setup-slopflow-skills` before Slopflow issue execution.

3. If Slopflow is not initialized, ask before running:

   ```bash
   slopflow init
   ```

4. Start scoped issue work:

   ```bash
   slopflow start <issue-id>
   ```

5. Read the canonical contract and goal prompt:

   ```text
   .slopflow/work/<issue-id>/contract.md
   .slopflow/work/<issue-id>/goal-prompt.md
   ```

6. Implement only the contract scope. Preserve existing behavior unless the issue execution contract explicitly changes it.

7. Capture command-based quality evidence through Slopflow:

   ```bash
   slopflow test <issue-id> --name <gate> -- <command...>
   ```

   Examples:

   ```bash
   slopflow test <issue-id> --name test -- npm test
   slopflow test <issue-id> --name typecheck -- npm run build
   ```

8. Pause, resume, or cancel local issue work only when the issue lifecycle calls for it:

   ```bash
   slopflow pause <issue-id> --reason <text>
   slopflow resume <issue-id>
   slopflow cancel <issue-id> --reason <text>
   ```

   These commands preserve artifacts and update local lifecycle state. They must not be treated as process control, VCS cleanup, issue closure, or automatic continuation.

9. Prepare a review packet and inspect reviewer verdict state:

   ```bash
   slopflow review <issue-id>
   ```

10. Do not write `review.json` unless you are acting as a separate human or agent reviewer. The implementer must not self-approve by writing their own reviewer verdict.

11. Complete only through Slopflow gates:

   ```bash
   slopflow complete <issue-id>
   ```

12. Report the Slopflow artifacts, tests, review verdict, and completion note in the final response.

## Agent attempt workflow

Use this flow only when the installed Slopflow CLI exposes `attempt` commands. Do not simulate these artifacts by hand.

1. Create isolated agent attempts from an already-started issue work directory:

   ```bash
   slopflow attempt create <issue-id> --count <n>
   slopflow attempt list <issue-id>
   ```

   The canonical repository owns `.slopflow/work/<issue-id>/` artifacts. Each agent attempt has `.slopflow/work/<issue-id>/attempts/<attempt-id>/` artifacts and an isolated execution workspace. The execution workspace is where code is edited, tested, reviewed, and completed after promotion.

2. In an attempt workspace, follow the attempt prompt and record attempt-scoped evidence:

   ```bash
   slopflow test <issue-id> --attempt <attempt-id> --name <gate> -- <command...>
   ```

   Attempt-scoped evidence is written back to canonical attempt artifacts through `.slopflow-attempt.json`. It does not satisfy canonical completion gates until the selected attempt is promoted.

3. Before submitting an attempt, write the attempt summary requested by Slopflow, then submit:

   ```bash
   slopflow attempt submit <issue-id> <attempt-id>
   ```

   Do not treat an implementation summary as reviewer approval.

4. Compare submitted attempts and select one explicitly:

   ```bash
   slopflow attempt compare <issue-id>
   slopflow attempt select <issue-id> <attempt-id> --reason "<why this attempt should continue>"
   ```

   Slopflow does not choose the best attempt automatically. Selection records a decision; it does not approve, promote, complete, or move code.

5. Promote the selected attempt before ordinary review/completion gates:

   ```bash
   slopflow attempt promote <issue-id>
   ```

   Promotion is artifact-only: it copies or references selected attempt evidence and records the selected execution workspace. It must not be treated as merge, cherry-pick, patch application, publish, approval, or completion. After promotion, run `review` and `complete` from the selected execution workspace.

6. Abandon stopped attempts explicitly and preserve their artifacts:

   ```bash
   slopflow attempt abandon <issue-id> <attempt-id> --reason <text>
   ```

## Safety rules

- Do not manually fabricate test evidence, review verdicts, completion notes, or status metadata.
- Do not manually fabricate attempt artifacts, attempt locks, selection records, or promotion metadata.
- Do not bypass `review.json`, `slopflow review`, or `slopflow complete`.
- Do not treat your own implementation summary as reviewer approval.
- Do not mark work complete if any Slopflow gate is blocked.
- Do not expand beyond the issue execution contract.
- Do not call parallel work a `run` or `canonical run`; use `agent attempt`, `selected attempt`, `canonical repository`, and `execution workspace`.
- Do not merge, cherry-pick, publish, push, or move code between workspaces during artifact-only promotion unless the user explicitly requests separate VCS work.
- Do not push, merge, publish, create a pull request, or close an issue unless the user explicitly asks.
- If validation fails, fix the cause and rerun the relevant Slopflow command instead of reporting partial completion.

## Current command loop

```text
slopflow init
slopflow status
slopflow start <issue-id>
slopflow pause <issue-id> --reason <text>
slopflow resume <issue-id>
slopflow cancel <issue-id> --reason <text>
slopflow test <issue-id> --name <gate> -- <command...>
slopflow test <issue-id> --attempt <attempt-id> --name <gate> -- <command...>
slopflow attempt create <issue-id> [--count <n>]
slopflow attempt list <issue-id>
slopflow attempt status <issue-id> [attempt-id]
slopflow attempt submit <issue-id> <attempt-id>
slopflow attempt abandon <issue-id> <attempt-id> --reason <text>
slopflow attempt compare <issue-id>
slopflow attempt select <issue-id> <attempt-id> --reason <text>
slopflow attempt promote <issue-id>
slopflow review <issue-id>
slopflow complete <issue-id>
```

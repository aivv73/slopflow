---
name: slopflow-live
description: Follow Slopflow's controlled issue execution workflow with live read-only project context injected through Claude-compatible skill shell interpolation.
allowed-tools: Bash
---

# Slopflow Live

Use this skill when working in a repository that uses Slopflow and the agent runtime supports Claude-compatible skill shell interpolation.

This skill is compatible with Claude Code skill shell execution and with Pi when `pi-skill-interpolation` is installed. The live context below is a snapshot rendered before the model sees the skill. Rerun Slopflow commands before making gate decisions.

For a newly onboarded project, run the `setup-slopflow-skills-live` skill first. It records the repository's issue tracker, triage label vocabulary, and domain documentation layout in `docs/agents/*.md` before this execution workflow starts work item execution.

If shell execution is disabled by policy, treat the live context as unavailable and run the read-only inspection commands manually.

## What it does

- Injects a read-only snapshot of current Slopflow, configured VCS, work artifact, domain, and ADR context before the model sees the skill.
- Keeps issue execution scoped to Slopflow's local artifacts and gates.
- Starts work item intake with `slopflow start <provider-native-id>`.
- Records test evidence with `slopflow test <work-key-or-provider-native-id> --name <gate> -- <command...>`.
- Coordinates parallel agent attempts through artifacts, isolated execution workspaces, comparison, selection, and artifact-only promotion without controlling agent processes.
- Supports local lifecycle state with `pause`, `resume`, and `cancel` without controlling an agent runtime.
- Prepares review packets with `slopflow review <work-key-or-provider-native-id>` without self-approval.
- Completes work only through `slopflow complete <work-key-or-provider-native-id>` after test evidence and reviewer approval.

## Live context

- Slopflow status: !`slopflow status 2>&1 || true`
- VCS status: !`if test -d .jj && command -v jj >/dev/null 2>&1; then jj --no-pager status; elif command -v git >/dev/null 2>&1; then git status --short --branch; else echo 'no supported VCS tool found'; fi 2>&1 || true`
- Active Slopflow work files: !`find .slopflow/work -maxdepth 5 -type f 2>/dev/null | sort | sed -n '1,200p' || true`
- Attempt workspace pointer: !`test -f .slopflow-attempt.json && cat .slopflow-attempt.json || true`
- Agent setup docs: !`for file in docs/agents/issue-tracker.md docs/agents/triage-labels.md docs/agents/domain.md; do test -f "$file" && echo "present: $file" || echo "missing: $file"; done`
- Domain context snapshot: !`sed -n '1,220p' CONTEXT.md 2>/dev/null || true`
- Recent ADR snapshot: !`for file in $(find docs/adr -maxdepth 1 -type f 2>/dev/null | sort | tail -5); do echo "--- $file"; sed -n '1,120p' "$file"; done || true`

Interpolation requires the `allowed-tools` frontmatter above. Without a Bash permission, `!command` patterns are passed through as literal text by Agent Skills implementations.

## Core rule

The Slopflow CLI output and `.slopflow/work/<work-key>/` artifacts are canonical. Live context is advisory and may be stale after any change. Do not manually invent, rewrite, or bypass Slopflow artifacts when a CLI command exists for that step.

Slopflow is a CLI-runbook, not an agent runtime. Agent attempts are Slopflow-owned artifacts for coordinating independent work across a canonical repository and isolated execution workspaces. Use only attempt commands exposed by the installed CLI.

## Workflow

1. Inspect current state. Prefer the live status above for orientation, then rerun before acting:

   ```bash
   slopflow status
   ```

2. If this is a new project and `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, or `docs/agents/domain.md` are missing, pause and ask to run `setup-slopflow-skills-live` before Slopflow issue execution.

3. If Slopflow is not initialized, ask before running:

   ```bash
   slopflow init
   ```

4. Start scoped work item intake:

   ```bash
   slopflow start <provider-native-id>
   ```

5. Read the canonical contract and goal prompt:

   ```text
   .slopflow/work/<work-key>/contract.md
   .slopflow/work/<work-key>/goal-prompt.md
   ```

6. Implement only the contract scope. Preserve existing behavior unless the issue execution contract explicitly changes it.

7. Capture command-based quality evidence through Slopflow:

   ```bash
   slopflow test <work-key-or-provider-native-id> --name <gate> -- <command...>
   ```

8. Pause, resume, or cancel local issue work only when the issue lifecycle calls for it:

   ```bash
   slopflow pause <work-key-or-provider-native-id> --reason <text>
   slopflow resume <work-key-or-provider-native-id>
   slopflow cancel <work-key-or-provider-native-id> --reason <text>
   ```

   These commands preserve artifacts and update local lifecycle state. They must not be treated as process control, VCS cleanup, issue closure, or automatic continuation.

9. Prepare a review packet and inspect reviewer verdict state:

   ```bash
   slopflow review <work-key-or-provider-native-id>
   ```

10. Do not write `review.json` unless you are acting as a separate human or agent reviewer. The implementer must not self-approve by writing their own reviewer verdict.

11. Complete only through Slopflow gates:

   ```bash
   slopflow complete <work-key-or-provider-native-id>
   ```

12. Report the Slopflow artifacts, tests, review verdict, and completion note in the final response.

## Agent attempt workflow

Use this flow only when the installed Slopflow CLI exposes `attempt` commands. Do not simulate these artifacts by hand.

1. Create isolated agent attempts from an already-started issue work directory:

   ```bash
   slopflow attempt create <work-key-or-provider-native-id> --count <n>
   slopflow attempt list <work-key-or-provider-native-id>
   ```

   The canonical repository owns `.slopflow/work/<work-key>/` artifacts. Each agent attempt has `.slopflow/work/<work-key>/attempts/<attempt-id>/` artifacts and an isolated execution workspace. The execution workspace is where code is edited, tested, reviewed, and completed after promotion.

2. In an attempt workspace, follow the attempt prompt and record attempt-scoped evidence:

   ```bash
   slopflow test <work-key-or-provider-native-id> --attempt <attempt-id> --name <gate> -- <command...>
   ```

   Attempt-scoped evidence is written back to canonical attempt artifacts through `.slopflow-attempt.json`. It does not satisfy canonical completion gates until the selected attempt is promoted.

3. Before submitting an attempt, write the attempt summary requested by Slopflow, then submit:

   ```bash
   slopflow attempt submit <work-key-or-provider-native-id> <attempt-id>
   ```

   Do not treat an implementation summary as reviewer approval.

4. Compare submitted attempts and select one explicitly:

   ```bash
   slopflow attempt compare <work-key-or-provider-native-id>
   slopflow attempt select <work-key-or-provider-native-id> <attempt-id> --reason "<why this attempt should continue>"
   ```

   Slopflow does not choose the best attempt automatically. Selection records a decision; it does not approve, promote, complete, or move code.

5. Promote the selected attempt before ordinary review/completion gates:

   ```bash
   slopflow attempt promote <work-key-or-provider-native-id>
   ```

   Promotion is artifact-only: it copies or references selected attempt evidence and records the selected execution workspace. It must not be treated as merge, cherry-pick, patch application, publish, approval, or completion. After promotion, run `review` and `complete` from the selected execution workspace.

6. Abandon stopped attempts explicitly and preserve their artifacts:

   ```bash
   slopflow attempt abandon <work-key-or-provider-native-id> <attempt-id> --reason <text>
   ```

## Interpolation safety

The interpolation commands in this skill are read-only inspection commands. They must not start work, run tests, create review verdicts, complete work, push, publish, merge, create pull requests, or close issues.

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
slopflow start <provider-native-id>
slopflow pause <work-key-or-provider-native-id> --reason <text>
slopflow resume <work-key-or-provider-native-id>
slopflow cancel <work-key-or-provider-native-id> --reason <text>
slopflow test <work-key-or-provider-native-id> --name <gate> -- <command...>
slopflow test <work-key-or-provider-native-id> --attempt <attempt-id> --name <gate> -- <command...>
slopflow attempt create <work-key-or-provider-native-id> [--count <n>]
slopflow attempt list <work-key-or-provider-native-id>
slopflow attempt status <work-key-or-provider-native-id> [attempt-id]
slopflow attempt submit <work-key-or-provider-native-id> <attempt-id>
slopflow attempt abandon <work-key-or-provider-native-id> <attempt-id> --reason <text>
slopflow attempt compare <work-key-or-provider-native-id>
slopflow attempt select <work-key-or-provider-native-id> <attempt-id> --reason <text>
slopflow attempt promote <work-key-or-provider-native-id>
slopflow review <work-key-or-provider-native-id>
slopflow complete <work-key-or-provider-native-id>
```

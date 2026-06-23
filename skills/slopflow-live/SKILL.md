---
name: slopflow-live
description: Follow Slopflow's controlled issue execution workflow with live read-only project context injected through Claude-compatible skill shell interpolation.
allowed-tools: Bash
---

# Slopflow Live

Use this skill when working in a repository that uses Slopflow and the agent runtime supports Claude-compatible skill shell interpolation.

This skill is compatible with Claude Code skill shell execution and with Pi when `pi-skill-interpolation` is installed. The live context below is a snapshot rendered before the model sees the skill. Rerun Slopflow commands before making gate decisions.

If shell execution is disabled by policy, treat the live context as unavailable and run the read-only inspection commands manually.

## What it does

- Injects a read-only snapshot of current Slopflow, Jujutsu, work artifact, domain, and ADR context before the model sees the skill.
- Keeps issue execution scoped to Slopflow's local artifacts and gates.
- Starts issue work with `slopflow start <issue-id>`.
- Records test evidence with `slopflow test <issue-id> --name <gate> -- <command...>`.
- Supports local lifecycle state with `pause`, `resume`, and `cancel` without controlling an agent runtime.
- Prepares review packets with `slopflow review <issue-id>` without self-approval.
- Completes work only through `slopflow complete <issue-id>` after test evidence and reviewer approval.

## Live context

- Slopflow status: !`slopflow status 2>&1 || true`
- Jujutsu status: !`jj --no-pager status 2>&1 || true`
- Active Slopflow work files: !`find .slopflow/work -maxdepth 3 -type f 2>/dev/null | sort | sed -n '1,160p' || true`
- Domain context snapshot: !`sed -n '1,220p' CONTEXT.md 2>/dev/null || true`
- Recent ADR snapshot: !`for file in $(find docs/adr -maxdepth 1 -type f 2>/dev/null | sort | tail -5); do echo "--- $file"; sed -n '1,120p' "$file"; done || true`

Interpolation requires the `allowed-tools` frontmatter above. Without a Bash permission, `!command` patterns are passed through as literal text by Agent Skills implementations.

## Core rule

The Slopflow CLI output and `.slopflow/work/<issue-id>/` artifacts are canonical. Live context is advisory and may be stale after any change. Do not manually invent, rewrite, or bypass Slopflow artifacts when a CLI command exists for that step.

## Workflow

1. Inspect current state. Prefer the live status above for orientation, then rerun before acting:

   ```bash
   slopflow status
   ```

2. If Slopflow is not initialized, ask before running:

   ```bash
   slopflow init
   ```

3. Start scoped issue work:

   ```bash
   slopflow start <issue-id>
   ```

4. Read the canonical contract and goal prompt:

   ```text
   .slopflow/work/<issue-id>/contract.md
   .slopflow/work/<issue-id>/goal-prompt.md
   ```

5. Implement only the contract scope. Preserve existing behavior unless the issue execution contract explicitly changes it.

6. Capture command-based quality evidence through Slopflow:

   ```bash
   slopflow test <issue-id> --name <gate> -- <command...>
   ```

7. Pause, resume, or cancel local issue work only when the issue lifecycle calls for it:

   ```bash
   slopflow pause <issue-id> --reason <text>
   slopflow resume <issue-id>
   slopflow cancel <issue-id> --reason <text>
   ```

   These commands preserve artifacts and update local lifecycle state. They must not be treated as process control, VCS cleanup, issue closure, or automatic continuation.

8. Prepare a review packet and inspect reviewer verdict state:

   ```bash
   slopflow review <issue-id>
   ```

9. Do not write `review.json` unless you are acting as a separate human or agent reviewer. The implementer must not self-approve by writing their own reviewer verdict.

10. Complete only through Slopflow gates:

   ```bash
   slopflow complete <issue-id>
   ```

11. Report the Slopflow artifacts, tests, review verdict, and completion note in the final response.

## Interpolation safety

The interpolation commands in this skill are read-only inspection commands. They must not start work, run tests, create review verdicts, complete work, push, publish, merge, create pull requests, or close issues.

## Safety rules

- Do not manually fabricate test evidence, review verdicts, completion notes, or status metadata.
- Do not bypass `review.json`, `slopflow review`, or `slopflow complete`.
- Do not treat your own implementation summary as reviewer approval.
- Do not mark work complete if any Slopflow gate is blocked.
- Do not expand beyond the issue execution contract.
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
slopflow review <issue-id>
slopflow complete <issue-id>
```

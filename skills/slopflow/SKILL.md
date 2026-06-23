---
name: slopflow
description: Follow Slopflow's controlled issue execution workflow for AI coding agents: start scoped issue work, capture test evidence, prepare review packets, respect reviewer verdicts, and complete only through local gates.
---

# Slopflow

Use this skill when working in a repository that uses Slopflow, or when the user asks you to implement an existing issue through Slopflow.

## Core rule

The Slopflow CLI output and `.slopflow/work/<issue-id>/` artifacts are canonical. Do not manually invent, rewrite, or bypass Slopflow artifacts when a CLI command exists for that step.

## Workflow

1. Inspect current state:

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

   Examples:

   ```bash
   slopflow test <issue-id> --name test -- npm test
   slopflow test <issue-id> --name typecheck -- npm run build
   ```

7. Prepare a review packet and inspect reviewer verdict state:

   ```bash
   slopflow review <issue-id>
   ```

8. Do not write `review.json` unless you are acting as a separate human or agent reviewer. The implementer must not self-approve by writing their own reviewer verdict.

9. Complete only through Slopflow gates:

   ```bash
   slopflow complete <issue-id>
   ```

10. Report the Slopflow artifacts, tests, review verdict, and completion note in the final response.

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
slopflow test <issue-id> --name <gate> -- <command...>
slopflow review <issue-id>
slopflow complete <issue-id>
```


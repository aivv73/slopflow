# Slopflow v0 is a CLI-runbook

Slopflow v0 is a local CLI-runbook and evidence gate, not an autonomous agent orchestrator. It bootstraps controlled work with `slopflow start <provider-native-id>`, stores canonical work item execution state under `.slopflow/work/<work-key>/`, mirrors that contract into Pi goals, and only marks local completion after required evidence and reviewer approval are present.

## Considered Options

- Build Slopflow as an autonomous agent orchestration runtime that directly runs Pi subagents through the full issue loop.
- Build Slopflow as a CLI-runbook that prepares state, records evidence, checks gates, and prints next safe actions.

## Consequences

- `run` is avoided for v0 because it implies execution; `start` means bootstrap only.
- v0 accepts a plain provider-native ID for the configured repository, but stores a structured work item reference internally.
- The issue execution contract in `.slopflow/work/<work-key>/contract.md` is canonical; the Pi goal is a runtime mirror.
- `start` writes `goal-prompt.md` by default; automatic Pi goal creation is opt-in via an explicit flag.
- `start` creates only real bootstrap artifacts such as `issue.md`, `contract.md`, `status.json`, and `next-steps.md`; evidence, review, and completion files are not placeholder-created.
- Test evidence is represented by canonical structured `evidence/tests.json` plus raw logs; if tests cannot run, `evidence/test-exception.md` records why and still requires reviewer acceptance.
- Browser and design evidence are declaration-driven quality gates: Slopflow checks them only when the issue execution contract requires them.
- Reviewer approval is represented by canonical structured `review.json`; `review.md` may exist as human-readable review notes.
- `slopflow test --name <gate> -- <command>` runs a named command and records evidence; `slopflow review` prepares a review packet and validates whether `review.json` approves completion.
- `slopflow init` creates minimal machine config in `.slopflow/config.json`; this is separate from `docs/agents/*.md`, which remains human/agent instruction.
- `complete` has no publish, push, merge, PR creation, or issue-closing side effects.

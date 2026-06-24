---
type: Index
title: Architectural decisions index
description: Progressive-disclosure index for Slopflow architectural decision records.
tags: [architecture, adr, index, okf]
---

# Architectural Decisions Index

Concise map of Slopflow's architectural decision records.

## Decisions

- [ADR 0001 — Slopflow v0 is a CLI-runbook](0001-slopflow-v0-is-a-cli-runbook.md): v0 prepares state, records evidence, checks gates, and avoids autonomous orchestration.
- [ADR 0002 — Slopflow CLI is TypeScript-first](0002-slopflow-cli-is-typescript-first.md): TypeScript is the v0 implementation and distribution path.
- [ADR 0003 — Test evidence keeps attempt history](0003-test-evidence-keeps-attempt-history.md): test evidence stores append-only attempts plus latest gate status.
- [ADR 0004 — Review command does not self-approve](0004-review-command-does-not-self-approve.md): review prepares packets and validates verdicts without writing approval.
- [ADR 0005 — Complete is a local artifact gate](0005-complete-is-a-local-artifact-gate.md): completion is local and gated by evidence and review, not publishing.
- [ADR 0006 — Harness workflow packs are installed project-locally](0006-skills-are-distributed-by-skills-installers.md): explicit harness installs copy Slopflow skills and adapters only into project-local directories.
- [ADR 0007 — Lifecycle commands are artifact state transitions](0007-lifecycle-commands-are-artifact-state-transitions.md): pause, resume, and cancel manage local lifecycle artifacts only.
- [ADR 0008 — CLI output follows AXI principles](0008-cli-output-follows-axi-principles.md): default CLI output should be compact, structured, contextual, and bounded by Slopflow's runbook scope.
- [ADR 0009 — Agent docs use OKF; runtime artifacts remain Slopflow artifacts](0009-agent-docs-use-okf-runtime-artifacts-remain-slopflow-artifacts.md): repository agent docs use OKF conventions while `.slopflow/work/` remains CLI-owned runtime state.

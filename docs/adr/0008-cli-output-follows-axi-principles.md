# CLI output follows AXI principles

Slopflow CLI output should follow AXI-style agent-interface principles where they fit the CLI-runbook boundary. AXI is documented at <https://axi.md/>.

## Context

Slopflow is a local CLI-runbook for controlled issue execution by AI coding agents. Agents need to understand current run state, missing gates, evidence paths, review status, and next safe actions with minimal tool-discovery overhead.

AXI recommends agent-ergonomic CLI behavior such as token-efficient output, minimal default schemas, definitive empty/error states, structured errors and exit codes, content-first output, contextual next steps, and consistent help.

## Decision

Slopflow's default CLI output uses compact key-block output for canonical command results. Commands should prefer concrete state and next-step guidance over walls of help text.

Slopflow commands should:

- emit compact, agent-readable key blocks by default;
- include definitive statuses such as `initialized`, `blocked`, `pending`, `passed`, `failed`, or `complete`;
- include a concrete `next-step` or bounded help hint when useful;
- return nonzero exit codes for blocked or invalid command states;
- keep command mutations explicit and non-interactive;
- preserve Slopflow's local artifact gates instead of expanding into autonomous orchestration.

`slopflow --help` remains the consistent fallback for command reference. No-argument `slopflow` should prefer a compact home/status view over generic help.

## Consequences

- Future commands such as `doctor`, `install`, `validate`, `skill lint`, and `--json` modes should preserve a compact default interface before adding verbose output.
- Structured output is a product contract for agents, not incidental formatting.
- Slopflow remains a CLI-runbook and evidence gate. It must not become an agent runtime, GitHub replacement, browser framework, swarm framework, model router, memory system, or general automation platform.
- Adapters for GitHub, browser acceptance, design review, or install profiles should remain optional gates or setup helpers rather than core platform expansion.

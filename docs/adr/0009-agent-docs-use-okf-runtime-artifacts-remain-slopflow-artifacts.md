# Agent docs use OKF; runtime artifacts remain Slopflow artifacts

Slopflow's agent setup documentation should be compatible with the Open Knowledge Format (OKF), while runtime work artifacts remain canonical Slopflow artifacts. OKF is documented at <https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md>.

## Context

Slopflow uses repository-local markdown documents for domain context, agent setup, triage vocabulary, and architectural decisions. OKF defines a minimal, human- and agent-friendly convention: markdown files with YAML frontmatter, organized as a portable directory tree.

Slopflow also writes runtime artifacts under `.slopflow/work/<work-key>/`, including issue snapshots, contracts, evidence, review verdicts, and completion notes. These artifacts are canonical workflow records produced and validated by the Slopflow CLI.

## Decision

Agent-consumable setup documents under `docs/agents/` are OKF concept documents. They should use YAML frontmatter with at least a non-empty `type` field, and preferably `title`, `description`, and `tags`.

Directory indexes such as `docs/agents/index.md` and `docs/adr/index.md` may use OKF-style `type: Index` documents for progressive disclosure.

Runtime work artifacts under `.slopflow/work/<work-key>/` remain Slopflow artifacts, not OKF concepts by default. Their canonical shape is controlled by Slopflow commands and schemas, including:

- `contract.md`;
- `status.json`;
- `evidence/tests.json` and raw logs;
- `review.json`;
- `completion-note.md`.

Do not convert runtime artifacts into OKF concept documents unless a future ADR explicitly changes that boundary.

## Consequences

- Setup skills should continue generating OKF-compatible `docs/agents/*.md` documents.
- Review, evidence, completion, and status gates continue to rely on Slopflow's CLI-owned artifacts rather than generic knowledge-document conventions.
- Agents can traverse repository knowledge with OKF expectations without weakening Slopflow's canonical artifact model.
- This preserves Slopflow's anti-goals: it is not a GitHub replacement, browser framework, agent runtime, swarm framework, model router, memory system, or kitchen-sink platform.

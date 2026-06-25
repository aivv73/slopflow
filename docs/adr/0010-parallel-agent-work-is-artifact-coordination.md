# Parallel agent work is artifact coordination

Slopflow will support parallel agent work through staged Slopflow-owned agent-attempt artifacts and optional harness-specific launch points, while the core CLI remains a CLI-runbook rather than an agent runtime. The first slice owns attempt directories, prompts, summaries, and lifecycle state; later slices add workspace metadata, evidence paths, locks, comparison, selection, and promotion gates. Pi or other harness packs may launch actual agents against those artifacts without making the core CLI manage agent processes.

## Considered Options

- Keep parallel work entirely manual, with no first-class Slopflow artifacts.
- Let Slopflow core directly launch and supervise multiple agents.
- Treat parallel work as Slopflow-owned artifacts plus harness-specific execution integrations.

## Consequences

- `run` and `canonical run` remain avoided terms; the domain uses `agent attempt`, `selected attempt`, and canonical issue work instead.
- Core commands can be tested without a live agent harness and can preserve Slopflow's evidence/review boundary.
- Harness-specific integrations can provide convenience launchers, but they must not bypass attempt selection, review, or completion gates.
- The initial attempt-artifact slice uses issue-local sequential identifiers such as `a1`, `a2`, and `a3`.
- The initial attempt-artifact slice stores `attempt.json`, `goal-prompt.md`, optional evidence, and a required `summary.md`; `attempt submit` blocks until the summary exists.
- Later workspace-capable slices make an agent attempt a Slopflow artifact plus an isolated version-control workspace. Harness session or process identifiers remain optional integration metadata, not core-required state.
- Later workspace-capable slices create attempt workspaces outside the repository by default, under a configurable workspace root that defaults to a sibling `.slopflow-workspaces` location; `workspace.json` records the absolute workspace path.
- Later workspace creation is VCS-aware: Jujutsu repositories should use Jujutsu workspaces, Git repositories should use Git worktrees, and unsupported VCS modes should block with structured next-step output.
- Later workspace-capable `attempt create` creates both attempt artifacts and isolated workspaces by default; if a workspace cannot be created, attempt creation blocks instead of creating a half-valid attempt.
- Later attempt workspaces contain a `.slopflow-attempt.json` pointer to the canonical repository, issue id, and attempt id. This lets commands run from the isolated workspace while writing Slopflow artifacts back to the canonical work directory.
- Later parallel work separates the canonical repository, which owns Slopflow artifacts, from the execution workspace, whose code state is tested and reviewed. In normal issue work these are the same checkout; after parallel promotion they differ.
- Later attempt selection and attempt promotion are separate actions. Selection records which submitted attempt should continue; promotion performs the artifact and version-control preparation needed for canonical review and completion gates.
- Later initial promotion is artifact promotion only: it may copy or reference selected attempt evidence and write canonical metadata, but it must not automatically merge, cherry-pick, apply patches, publish, or move code changes between workspaces.
- After later workspace-capable promotion, canonical issue work continues in the selected attempt workspace. Review and completion gates should evaluate that workspace rather than assuming code changes were moved back to the original repository checkout.
- Later promoted review and completion gates must be invoked from the selected execution workspace; if invoked from the canonical repository checkout, they should block with a next step pointing to the selected workspace.
- Later parallel attempt coordination uses local filesystem artifact locks with issue work, attempt, and selection scopes. Lock conflicts block with structured output, and stale lock recovery requires an explicit force-style override.
- Later evidence commands remain canonical by default and become attempt-scoped only when an explicit attempt id is provided.
- Later review surface for parallel work is `attempt compare`, which writes a bounded comparison artifact for submitted attempts. Attempt-specific `review --attempt` is deferred so attempt comparison is not confused with canonical reviewer approval.

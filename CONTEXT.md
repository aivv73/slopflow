# Slopflow

Slopflow is a controlled issue execution workflow for AI coding agents. It exists to turn each issue into reviewable, testable, reversible engineering work without becoming a replacement agent runtime.

## Language

**Slopflow**:
A local CLI-runbook that coordinates existing agent, issue tracker, test, review, and version-control tools through explicit per-issue artifacts and gates.
_Avoid_: Agent runtime, GitHub replacement, browser automation framework, PRD generator

**CLI-runbook**:
A command-line workflow guide that prepares state, records evidence, checks gates, and prints the next safe action for a human or agent to perform.
_Avoid_: Autonomous orchestrator, background agent, daemon

**Start**:
The Slopflow action that bootstraps controlled work for an existing issue by preparing local artifacts, associating work with the configured VCS repository, and producing next-step instructions. Jujutsu is recommended, but Git is supported.
_Avoid_: Run, execute, implement

**Issue execution contract**:
The canonical local Slopflow artifact that records the issue summary, acceptance criteria, constraints, out-of-scope items, quality gates, blocked-stop conditions, and completion criteria for one issue.
_Avoid_: Goal, plan, checklist

**Issue reference**:
A structured identifier for the configured issue tracker item, including provider, repository, number, and whether the item is an issue or pull request.
_Avoid_: Bare issue id, ticket string

**Goal mirror**:
A Pi persistent goal created from the issue execution contract so the active coding session keeps the same objective in context.
_Avoid_: Canonical contract, source of truth

By default, `start` writes a `goal-prompt.md` artifact for creating a goal mirror. Automatic goal creation is opt-in.

**Work directory**:
The `.slopflow/work/<issue-id>/` directory that stores the local contract, evidence, reviewer verdict, status metadata, and completion note for one issue.
_Avoid_: Run directory, scratch folder, cache

Only real artifacts are stored in a work directory. Missing evidence, review, or completion files mean the corresponding gate has not been satisfied.

**Canonical repository**:
The repository checkout that owns `.slopflow/config.json` and canonical `.slopflow/work/<issue-id>/` artifacts.
_Avoid_: Source repo, main checkout, original repo

Artifact reads and writes resolve through the canonical repository, even when commands are invoked from an isolated attempt workspace.

**Execution workspace**:
The repository workspace whose code state is being tested, reviewed, or completed for an issue or attempt.
_Avoid_: Working directory, sandbox, run directory

In normal issue work, the canonical repository and execution workspace are the same checkout. In promoted parallel-attempt work, the canonical repository owns Slopflow artifacts while the selected attempt workspace is the execution workspace.
After parallel-attempt promotion, review and completion gates must be invoked from the selected execution workspace so VCS status, diffs, and command context match the promoted code state.

**Agent attempt**:
An isolated, reviewable attempt by one agent or agent session to satisfy one issue execution contract without overwriting other attempts for the same issue.
_Avoid_: Run, parallel run, agent job

Agent attempts are coordination artifacts, not managed agent processes. The initial agent-attempt slice creates attempt artifacts and prompts; later parallel-attempt slices may add workspaces, evidence locations, locks, comparison, selection records, and harness-specific launch integrations.

Agent attempt lifecycle statuses are `created`, `active`, `submitted`, `selected`, `rejected`, and `abandoned`. `complete` remains reserved for local issue work completion, and failed quality gates belong in attempt evidence rather than an attempt lifecycle status.

In the first design, agent attempt ids are issue-local sequential identifiers such as `a1`, `a2`, and `a3`, allocated while holding the issue work lock.
Each agent attempt stores `attempt.json`, `goal-prompt.md`, optional evidence, and a required `summary.md` before submission. Later workspace-capable attempts also store `workspace.json`. Attempt submission blocks when `summary.md` is missing so submitted attempts have a human-readable account of the work.

**Selected attempt**:
The single agent attempt chosen as the basis for continuing canonical issue work after comparing submitted attempts.
_Avoid_: Winner, canonical run, best agent

Selection records the decision to continue from one attempt; it does not by itself publish, merge, approve, or complete the issue work.

**Attempt comparison**:
A bounded review aid that summarizes submitted agent attempts for one issue so a human or reviewer agent can choose a selected attempt.
_Avoid_: Review verdict, approval, ranking engine

Attempt comparison is planned after attempt-scoped evidence exists. It may summarize attempt status, summaries, evidence, workspace metadata, changed files, and bounded diff excerpts. It does not select, approve, or complete an attempt by itself.

**Promote attempt**:
The Slopflow action that applies the selected attempt's artifacts and workspace state as the basis for canonical issue work after selection.
_Avoid_: Select, merge, approve, complete

Selecting an attempt records a decision; promoting an attempt performs the artifact and version-control preparation needed for ordinary review and completion gates to continue from that selected attempt.
In the planned parallel-attempt design, promotion is artifact promotion only: it does not automatically merge, cherry-pick, apply patches, publish, or otherwise move code changes between version-control workspaces.
After workspace-capable promotion, canonical issue work continues in the selected attempt workspace. Canonical artifacts record the promoted attempt and selected workspace path so later review and completion gates can evaluate the code state that produced the promoted evidence.

**Attempt workspace**:
An isolated version-control workspace associated with one agent attempt so concurrent agents can edit files without sharing a working tree.
_Avoid_: Scratch clone, temporary checkout, agent sandbox

When attempt workspaces are enabled, each attempt workspace contains a `.slopflow-attempt.json` pointer that identifies the canonical repository, issue id, and attempt id. Slopflow artifacts remain in the canonical repository, while wrapped commands invoked from an attempt workspace run in that workspace and record evidence back to the canonical attempt artifacts.

**Attempt lock**:
A local artifact lock that protects one agent attempt's Slopflow artifacts from concurrent mutation.
_Avoid_: Process lock, agent lease, distributed lock

Attempt locks protect artifact writes; they do not prove an agent process is alive or grant ownership of repository-wide work.

Planned parallel attempt coordination uses local filesystem artifact locks with three scopes: issue work locks for issue-level artifact mutation, attempt locks for one attempt's artifacts and evidence, and selection locks for the selected-attempt decision. Stale lock recovery is explicit and requires a force-style override.

**Complete**:
The Slopflow action that marks local issue work complete only after required evidence and reviewer approval are present.
_Avoid_: Publish, push, merge, close issue
Its v0 CLI shape is `slopflow complete <issue-id>`, where the issue id is required and numeric, initialized machine config is required, and the issue work directory plus `status.json` must exist.
It generates `completion-note.md` when missing after all gates pass, but preserves an existing completion note written by a human or agent.
In v0, completion requires at least one latest test evidence gate to be passed and no latest test evidence gate to be failed; it does not parse required gates from the markdown issue execution contract.
If test evidence is missing, v0 completion may proceed only when `evidence/test-exception.md` exists and the reviewer verdict is complete, treating the reviewer approval as acceptance of the exception.
It preserves existing `status.json` fields and sets `status: "complete"` plus `completed_at` when local completion succeeds.
It verifies the configured VCS status is readable but does not require an empty diff, because local changes are the issue work under review.
Its output status is `complete` on success or `blocked` when a required local artifact gate is missing or failing, with exit code 2 for blocked completion.

**Pause**:
The Slopflow action that records an intentional temporary stop for issue work by writing a local pause note and marking the work status as paused.
_Avoid_: Kill process, stop agent, stash changes

**Resume**:
The Slopflow action that rehydrates local issue work context and, when work is paused, marks it active again without running quality gates or review gates.
_Avoid_: Restart agent, continue automatically, run pending work

**Cancel**:
The Slopflow action that records an intentional local cancellation of issue work while preserving the work directory and evidence for inspection.
_Avoid_: Delete artifacts, close issue, abandon Jujutsu change, abort process

**Lifecycle status**:
The local issue work state stored in `status.json`, such as active, paused, cancelled, or complete.
_Avoid_: Gate result, process state, GitHub issue state

`blocked` is a command result for an unsatisfied gate, not a lifecycle status.


**Reviewer verdict**:
The canonical structured review decision in `.slopflow/work/<issue-id>/review.json` that states whether the issue work is complete or requires changes.
_Avoid_: Review notes, approval comment
It uses schema version 1 with `verdict`, `reviewer`, `reviewed_at`, `summary`, and `required_changes`. A complete verdict must have no required changes; a changes-requested verdict must list actionable required changes.
If `review.json` exists but does not match the schema, the review command treats it as a blocked gate artifact and exits with code 2 after updating the review packet.

**Test evidence**:
The canonical structured test record in `.slopflow/work/<issue-id>/evidence/tests.json`, with raw command logs stored beside it, that proves which quality gates ran and whether they passed.
_Avoid_: Test claim, informal summary

It keeps an append-only attempt history and a latest-result index per gate. The latest index points to the current attempt id and current status for each gate, while the attempts list preserves full review history.

Each test evidence attempt uses a timestamp-based attempt id and log filename, such as `unit-2026-06-23T01-27-00-000Z` and `evidence/logs/unit-2026-06-23T01-27-00-000Z.txt`.

**Test exception**:
A written explanation in `.slopflow/work/<issue-id>/evidence/test-exception.md` for why required tests could not run, which still requires reviewer acceptance before completion.
_Avoid_: Skipped tests, ignored failure

**Quality gate**:
A contract-declared verification requirement, such as tests, browser acceptance, or design review, that must have matching evidence before completion.
_Avoid_: Nice-to-have check, optional validation

**Test command**:
The Slopflow action that runs a named command-based quality gate and records its structured result plus raw log as test evidence. It can capture unit tests, lint, typecheck, build, or any other command-based verification declared by the issue execution contract.
_Avoid_: Test runner, test framework
Its v0 CLI shape is `slopflow test <issue-id> --name <gate> -- <command...>`, where the issue id is numeric, `--name` is required, gate names use lowercase letters/numbers/underscore/hyphen, and `--` is required before the wrapped command.
By default, it returns the wrapped command's exit code even when failure evidence is recorded successfully.
In v0, wrapped commands run from the repository root for reproducibility; package-specific commands must encode their own working-directory behavior.
Raw test logs include a metadata header plus separate stdout and stderr sections so each log is useful as standalone review evidence.
It refuses to run unless the issue work directory and `status.json` already exist, because evidence must attach to a started issue execution contract.
When attempt-scoped test evidence is implemented, it does not by itself satisfy canonical completion gates; selected attempt evidence must first be promoted or otherwise represented in canonical issue evidence.

**Review command**:
The Slopflow action that prepares a review packet and reports whether a reviewer verdict exists and approves completion.
_Avoid_: Reviewer agent, automatic approval
Its v0 CLI shape is `slopflow review <issue-id>`, where the issue id is required and numeric, initialized machine config is required, and the issue work directory plus `status.json` must exist.
It never creates `review.json`; reviewer verdicts are written by a separate human or agent reviewer so Slopflow does not self-approve work.
Its review packet is a hybrid artifact: it inlines the contract, test evidence summary, configured VCS status, changed files, reviewer instructions, and a bounded diff excerpt, while referencing full logs and commands for deeper inspection. The v0 inline diff limit is 50,000 characters.
It does not block when test evidence is missing; instead it marks missing evidence in the packet and output so the reviewer can request changes. Completion remains the strict evidence gate.
Its output statuses are `pending` when `review.json` is missing, `complete` when the verdict approves completion, `changes-requested` when the verdict requests changes, and `blocked` when the verdict artifact is invalid.

**Machine config**:
The minimal `.slopflow/config.json` file that stores CLI-readable project settings such as artifact root, issue tracker, and version-control type.
_Avoid_: Agent instructions, domain docs, product spec

**Agent skill**:
A distributable instruction package that teaches an agent harness how to follow Slopflow safely. Agent skills are distributed through a skills installer such as Vercel Skills rather than being installed or wired into each agent harness by the Slopflow CLI.
_Avoid_: CLI plugin, runtime integration, built-in agent adapter

**Setup skill**:
An agent skill intended to run first in a newly onboarded project so the project's issue tracker, triage label vocabulary, and domain documentation layout are recorded before issue execution starts.
_Avoid_: CLI initializer, automatic installer, Slopflow machine config

**npm package**:
The Slopflow distribution artifact for the command-line tool. It should contain the executable CLI and package metadata, while agent skill placement is delegated to the skills installer.
_Avoid_: Universal agent harness installer, skills manager

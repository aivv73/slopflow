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
The Slopflow action that bootstraps controlled work for an existing issue by preparing local artifacts, associating a Jujutsu change, and producing next-step instructions.
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

**Complete**:
The Slopflow action that marks local issue work complete only after required evidence and reviewer approval are present.
_Avoid_: Publish, push, merge, close issue


**Reviewer verdict**:
The canonical structured review decision in `.slopflow/work/<issue-id>/review.json` that states whether the issue work is complete or requires changes.
_Avoid_: Review notes, approval comment

**Test evidence**:
The canonical structured test record in `.slopflow/work/<issue-id>/evidence/tests.json`, with raw command logs stored beside it, that proves which quality gates ran and whether they passed.
_Avoid_: Test claim, informal summary

**Test exception**:
A written explanation in `.slopflow/work/<issue-id>/evidence/test-exception.md` for why required tests could not run, which still requires reviewer acceptance before completion.
_Avoid_: Skipped tests, ignored failure

**Quality gate**:
A contract-declared verification requirement, such as tests, browser acceptance, or design review, that must have matching evidence before completion.
_Avoid_: Nice-to-have check, optional validation

**Test command**:
The Slopflow action that runs a named command and records its structured result plus raw log as test evidence.
_Avoid_: Test runner, test framework

**Review command**:
The Slopflow action that prepares a review packet and reports whether a reviewer verdict exists and approves completion.
_Avoid_: Reviewer agent, automatic approval

**Machine config**:
The minimal `.slopflow/config.json` file that stores CLI-readable project settings such as artifact root, issue tracker, and version-control type.
_Avoid_: Agent instructions, domain docs, product spec

# Slopflow

A project-local outer loop for accountable AI coding work.

Coding agents already have an inner loop: read files, call tools, edit code, run tests, and eventually say “done.” Slopflow provides the outer loop around that agent loop: setup, issue contracts, test evidence, review packets, and completion gates that decide whether “done” actually means done.

It is inspired by the harness-level loop pattern described in Armin Ronacher’s [The Coming Loop](https://lucumr.pocoo.org/2026/6/23/the-coming-loop/): work is attempted by machines, but a harness decides whether to continue, retry, hand off, or stop.

Slopflow’s bias is conservative: keep the loop bounded, legible, project-local, and reviewable.

It turns AI slop into scoped, tested, reviewed, reversible changes.

## Why Slopflow exists

Coding agents are useful, but a model saying “done” is not a completion contract. Slopflow gives agents and humans a local runbook for issue execution:

- initialize a repository workflow contract
- install harness-specific skills, extensions, and agent roles
- start work from a GitHub issue or pull request
- record test evidence instead of merely claiming tests passed
- prepare review packets
- block local completion until evidence and review gates pass

Slopflow is not an autonomous coding agent. It is the runbook around coding agents: setup, contracts, evidence, review, and completion.

## Who this is for

Slopflow is for people who use coding agents across repositories and want the workflow to be reproducible instead of reconstructed from memory every time.

It is especially useful if you:

- work from GitHub issues or PRs
- want agents to record evidence instead of merely reporting success
- use Pi, Claude Code, or Agent Skills-compatible tooling
- prefer project-local configuration over global harness mutation
- care about reviewable artifacts and explicit completion gates
- want to experiment with harness-level loops without giving up human judgment

It is probably not what you want if you are looking for a fully autonomous auto-merge bot.

## Mental model

Slopflow has three layers.

### 1. Workflow pack

`slopflow init` creates the minimal project-local Slopflow contract.

`slopflow install --harness ...` installs a project-local workflow pack for the agent harness you actually use.

### 2. Outer loop

Slopflow controls issue execution outside the model’s inner tool loop:

```text
start -> test -> review -> complete
```

The model can work, but Slopflow owns the lifecycle artifacts and gates.

### 3. Adapters

Slopflow connects the workflow to harnesses and tools:

- Pi
- Claude Code
- generic Agent Skills-compatible tools
- Jujutsu (`jj`)
- GitHub
- `pi-subagents`
- `pi-codex-goal`

## Quick start

Slopflow requires Node.js 24 or newer.

Install the CLI:

```bash
npm install -g slopflow
```

From the repository you want agents to work in:

```bash
slopflow init
```

The current issue workflow is optimized for Jujutsu (`jj`) and GitHub; `slopflow doctor` will report missing prerequisites and setup gaps.

Install a workflow pack. Dry-run is the default:

```bash
slopflow install --harness pi
```

Apply after reviewing the plan:

```bash
slopflow install --harness pi --yes
```

Other supported harnesses:

```bash
slopflow install --harness claude-code --yes
slopflow install --harness generic --yes
```

Check readiness:

```bash
slopflow doctor
```

Start controlled work for an issue:

```bash
slopflow start 42
```

Then follow the generated artifacts under:

```text
.slopflow/work/42/
```

## What Slopflow writes

### `slopflow init`

Creates the minimal Slopflow contract:

```text
.slopflow/config.json
.slopflow/work/
```

Existing incompatible `.slopflow/config.json` blocks unless rerun with explicit `--force`.

### `slopflow install --harness pi`

Installs a project-local Pi workflow pack:

```text
.pi/settings.json
.pi/skills/
.pi/extensions/slopflow/index.ts
.pi/agents/slopflow-planner.md
.pi/agents/slopflow-executor.md
.pi/agents/slopflow-reviewer.md
```

The Pi pack merges these project-local packages into `.pi/settings.json`:

```text
npm:@howaboua/pi-codex-conversion
git:github.com/joelhooks/pi-skill-interpolation
npm:@tintinweb/pi-subagents
npm:pi-codex-goal
```

The local Slopflow Pi extension registers:

```text
/slopflow-status
/slopflow-doctor
/slopflow-create-goal <issue-id>
```

`/slopflow-create-goal <issue-id>` runs `slopflow start`, reads the generated `goal-prompt.md`, and pre-fills `pi-codex-goal`’s `/create-goal` prompt for user review.

The installed Pi subagent roles are:

- `slopflow-planner` — read-only planning agent with `skills: slopflow-live`
- `slopflow-executor` — write-capable execution agent with `prompt_mode: append`
- `slopflow-reviewer` — read-only review agent with `thinking: high`

### `slopflow install --harness claude-code`

Installs live Slopflow skills under:

```text
.claude/skills/
```

### `slopflow install --harness generic`

Installs portable Agent Skills under:

```text
.agents/skills/
```

Use `generic` for Agent Skills-compatible environments where Slopflow should not assume Pi or Claude Code features.

## Safety guarantees

Slopflow does not:

- install global packages
- mutate global Claude, Pi, Cursor, or other harness configuration
- push
- publish
- create pull requests
- close issues
- merge changes
- fabricate evidence, review verdicts, completion notes, or status metadata

`install` is dry-run by default. Use `--yes` to write project-local files. Existing differing harness pack files block unless rerun with explicit `--force`.

Deprecated setup commands:

- `slopflow install minimal` is replaced by `slopflow init`
- `slopflow install recommended` is replaced by explicit harness workflow packs

## The controlled work lifecycle

### Inspect state

```bash
slopflow status
```

### Start issue work

```bash
slopflow start 42
```

`start` creates canonical bootstrap artifacts:

```text
.slopflow/work/42/issue.md
.slopflow/work/42/contract.md
.slopflow/work/42/status.json
.slopflow/work/42/goal-prompt.md
.slopflow/work/42/next-steps.md
```

It does not create placeholder evidence, review, or completion files.

### Pause, resume, or cancel

```bash
slopflow pause 42 --reason "waiting for external review"
slopflow resume 42
slopflow cancel 42 --reason "superseded by another issue"
```

Lifecycle commands preserve the work directory and record local status only. They do not push, close issues, publish, delete evidence, or abandon VCS changes.

### Record test evidence

```bash
slopflow test 42 --name unit -- npm test
slopflow test 42 --name typecheck -- npm run build
```

`test` writes structured evidence and raw logs under:

```text
.slopflow/work/42/evidence/
```

Then it returns the wrapped command’s exit code.

### Coordinate agent attempts

For parallel agent work, Slopflow coordinates **agent attempts** as artifacts and isolated execution workspaces. Core Slopflow does not launch or supervise agents; it prepares attempt directories, workspaces, evidence targets, comparison packets, selection records, and promotion metadata.

Create attempts for an already-started issue:

```bash
slopflow attempt create 42 --count 3
slopflow attempt list 42
slopflow attempt status 42 a1
```

Each attempt stores artifacts under:

```text
.slopflow/work/42/attempts/a1/
  attempt.json
  workspace.json
  goal-prompt.md
  summary.md
  evidence/
```

`attempt create` creates an isolated version-control workspace by default and writes a pointer in that workspace:

```text
.slopflow-attempt.json
```

The pointer lets Slopflow commands run from the attempt workspace while writing evidence back to the canonical repository’s `.slopflow/work/<issue-id>/` artifacts.

Record attempt-scoped evidence from the attempt workspace:

```bash
slopflow test 42 --attempt a1 --name unit -- npm test
```

Attempt-scoped evidence is written under the selected attempt, not canonical issue evidence, and does not satisfy completion gates until the attempt is selected and promoted.

Submit, compare, select, and promote attempts:

```bash
slopflow attempt submit 42 a1
slopflow attempt compare 42
slopflow attempt select 42 a1 --reason "best evidence and smallest diff"
slopflow attempt promote 42
```

Selection records an auditable decision. Promotion is artifact-only: it copies or references selected attempt evidence and records the selected execution workspace. It does not merge, cherry-pick, apply patches, push, publish, create a PR, approve review, or complete work.

After promotion, run review and completion from the selected execution workspace:

```bash
cd /path/to/selected/attempt/workspace
slopflow review 42
slopflow complete 42
```

If invoked from the canonical repository checkout after promotion, review and completion block with a next step pointing to the selected execution workspace.

Attempts can be abandoned without deleting their artifacts:

```bash
slopflow attempt abandon 42 a2 --reason "superseded by a1"
```

By default attempt workspaces live outside the canonical repository under a sibling workspace root. `.slopflow/config.json` includes:

```json
{
  "workspace_root": ".slopflow-workspaces"
}
```

Relative `workspace_root` values resolve next to the canonical repository, not inside it.

### Prepare review

```bash
slopflow review 42
```

`review` writes:

```text
.slopflow/work/42/review-packet.md
```

It does not self-approve and does not create `review.json`. A separate human or agent reviewer must write the verdict.

### Complete locally

```bash
slopflow complete 42
```

`complete` checks evidence and reviewer gates, generates `completion-note.md` when missing, preserves an existing note, updates local `status.json`, and never publishes, pushes, merges, opens PRs, or closes issues.

## Output contract

Slopflow’s default output is an agent-facing, TOON-like key-block format: a named block followed by compact `key: value` fields and a concrete `next-step` or `help[...]` hint when useful.

Example success output:

```text
status:
  state: initialized
  repo: owner/name
  issue_tracker: github
  vcs: jj
  artifact-root: .slopflow/work
  next-step: slopflow start <issue-id>
```

Example structured error output:

```text
error:
  status: blocked
  message: <short reason>
  hint: <optional next action>
```

Canonical Slopflow status, gate, and error output is written to stdout so agents can parse a single structured stream. Stderr is reserved for debug output and wrapped-command logs.

Use `--json` when scripts or integrations need machine JSON output:

```bash
slopflow status --json
slopflow doctor --json
```

Errors with `--json` return structured JSON error objects:

```json
{
  "error": {
    "status": "blocked",
    "message": "Slopflow machine config is missing.",
    "hint": "Run `slopflow init` first."
  }
}
```

## Doctor and readiness

`slopflow doctor` is a read-only setup diagnostic. It reports a top-level status plus grouped severities:

```text
doctor:
  status: warn
  core: passed
  project-docs: passed
  recommended: warn
  failed-count: 0
  warning-count: 1
  next-step: run npx -y gh-axi --help when GitHub AXI operations are needed
checks[...]:
  core.node: passed node v26.1.0 satisfies >=24
  core.jj: passed jj executable found
  recommended.gh-axi: warn unchecked; run npx -y gh-axi --help when GitHub AXI operations are needed
```

Severity rules:

- `passed` — all core, project-doc, and recommended checks passed
- `warn` — core checks passed, but at least one project-doc or recommended check is missing, optional, or unchecked
- `failed` — at least one core readiness check failed; the command exits with code `2`

Doctor detail strings are intentionally bounded and summarized so setup diagnostics stay agent-readable instead of dumping full command output.

## Skills

Slopflow distributes four skills:

- `slopflow` — portable execution skill
- `slopflow-live` — live-context execution skill with read-only shell interpolation
- `setup-slopflow-skills` — portable setup skill
- `setup-slopflow-skills-live` — live-context setup skill

Harness workflow packs install the appropriate variants locally. You can also validate repository-distributed skill files without modifying anything:

```bash
slopflow skill lint
```

`skill lint` checks that portable skills avoid shell interpolation, live skills use read-only interpolation, Slopflow safety rules are present, and setup templates include OKF frontmatter where applicable.

## Conventions and influences

Slopflow follows a few explicit conventions so humans and agents can share context without guessing.

- [AXI](https://axi.md/) shapes the command output style: compact, structured, contextual, bounded, and easy for agents to parse.
- [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) shapes repository knowledge files and indexes, especially `docs/agents/*.md`, `docs/adr/`, and `CONTEXT.md`.
- [Matt Pocock’s engineering skills](https://github.com/mattpocock/skills/tree/main) influenced the setup-skill approach: encode team workflow, issue-tracker conventions, triage labels, and domain-documentation layout as reusable agent skills.

These conventions are not decoration. They are part of the outer loop: agents need stable local knowledge, structured output, and explicit artifacts to do useful work without inventing process on every task.

## Command reference

```text
slopflow init [--force]
slopflow status [--json]
slopflow doctor [--json]
slopflow install --harness pi|claude-code|generic [--yes] [--force]
slopflow skill lint
slopflow start <issue-id>
slopflow attempt create <issue-id> [--count <n>]
slopflow attempt list <issue-id>
slopflow attempt status <issue-id> [attempt-id]
slopflow attempt submit <issue-id> <attempt-id>
slopflow attempt abandon <issue-id> <attempt-id> --reason <text>
slopflow attempt compare <issue-id>
slopflow attempt select <issue-id> <attempt-id> --reason <text>
slopflow attempt promote <issue-id>
slopflow pause <issue-id> --reason <text>
slopflow resume <issue-id>
slopflow cancel <issue-id> --reason <text>
slopflow test <issue-id> --name <gate> -- <command...>
slopflow test <issue-id> --attempt <attempt-id> --name <gate> -- <command...>
slopflow review <issue-id>
slopflow complete <issue-id>
```

## Development

Slopflow uses TypeScript and npm for the CLI implementation.

Install dependencies:

```bash
npm install
```

Run the test suite:

```bash
npm test
```

Build the CLI:

```bash
npm run build
```

Check the npm package contents:

```bash
npm run pack:check
```

Run the install smoke test:

```bash
npm run pack:smoke
```

Run full local CI, matching the GitHub Actions workflow:

```bash
npm run ci
```

Check release readiness without publishing:

```bash
npm run release:check
```

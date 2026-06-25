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
- start work from a configured issue tracker provider's work item
- record test evidence instead of merely claiming tests passed
- prepare review packets
- block local completion until evidence and review gates pass

Slopflow is not an autonomous coding agent. It is the runbook around coding agents: setup, contracts, evidence, review, and completion.

## Who this is for

Slopflow is for people who use coding agents across repositories and want the workflow to be reproducible instead of reconstructed from memory every time.

It is especially useful if you:

- work from issue tracker provider work items such as GitHub issues/PRs or GitLab issues/MRs
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

### 3. Harnesses and integrations

Slopflow connects the workflow to harnesses and tools:

- Pi
- Claude Code
- generic Agent Skills-compatible tools
- Jujutsu (`jj`, recommended)
- Git
- issue tracker providers such as GitHub and GitLab
- `pi-subagents`
- `pi-codex-goal`

## Recommended harnesses

Slopflow is harness-independent.

It has workflow packs for:

- Pi
- Oh My Pi
- Claude Code
- generic Agent Skills-compatible environments

The best experience today is with Oh My Pi, which provides an excellent interactive execution environment while Slopflow manages contracts, evidence, and review.

## Quick start

Slopflow requires Node.js 24 or newer.

Install the CLI:

```bash
npm install -g slopflow
```

From the repository you want agents to work in, the shortest happy path is:

```bash
slopflow init
slopflow install --harness pi --yes
slopflow doctor
slopflow start 42
slopflow test 42 --name unit -- npm test
slopflow review 42
```

The current work item workflow supports Git and Jujutsu (`jj`) repositories. Jujutsu is recommended for the smoothest local change/workspace workflow, but it is not required; `slopflow doctor` reports missing prerequisites and setup gaps.

Use `install` without `--yes` when you want to review the workflow-pack plan before writing files:

```bash
slopflow install --harness pi
```

Other supported harnesses:

```bash
slopflow install --harness omp --yes
slopflow install --harness claude-code --yes
slopflow install --harness generic --yes
```

New starts use a generated work key, so the generated artifacts live under a path such as:

```text
.slopflow/work/github-owner-name-issue-42-1a2b3c4d/
```

## What Slopflow writes

### `slopflow init`

Creates the minimal Slopflow contract:

```text
.slopflow/config.json
.slopflow/work/
```

Existing incompatible `.slopflow/config.json` blocks unless rerun with explicit `--force`.

The default issue tracker config is GitHub, but issue intake is provider-shaped:

```json
{
  "issue_tracker": {
    "provider": "gitlab",
    "repository": "group/project",
    "base_url": "https://gitlab.example.com",
    "prs_as_request_surface": true
  }
}
```

`base_url` is optional for default hosted providers such as `https://github.com` and `https://gitlab.com`.

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
git:github.com/joelhooks/pi-skill-interpolation
npm:@tintinweb/pi-subagents
npm:pi-codex-goal
```

The local Slopflow Pi extension registers:

```text
/slopflow-status
/slopflow-doctor
/slopflow-create-goal <provider-native-id>
```

`/slopflow-create-goal <provider-native-id>` runs `slopflow start`, reads the generated `goal-prompt.md`, and pre-fills `pi-codex-goal`’s `/create-goal` prompt for user review. Codex-specific conversion helpers are runtime adapters and are not installed by default.

The installed Pi subagent roles are:

- `slopflow-planner` — read-only planning agent with `skills: slopflow-live`
- `slopflow-executor` — write-capable execution agent with `prompt_mode: append`
- `slopflow-reviewer` — read-only review agent with `thinking: high`


### `slopflow install --harness omp`

Slopflow installs capabilities, not a specific tool stack.

Installs an Oh My Pi workflow profile under:

```text
.omp/skills/
.omp/commands/
```

The OMP profile uses native OMP primitives instead of Codex adapter packages:

- subagents: OMP `task`
- goal mirrors: OMP `/goal`
- skill shell interpolation: requires `git:github.com/joelhooks/pi-skill-interpolation` in the active OMP/Pi environment

Slopflow does not install OMP itself and does not install `npm:@howaboua/pi-codex-conversion`, `npm:@tintinweb/pi-subagents`, or `npm:pi-codex-goal` for the OMP profile.

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

### Start work item work

```bash
slopflow start 42
```

`start` reads one work item from the configured issue tracker provider and creates canonical bootstrap artifacts:

```text
.slopflow/work/<work-key>/work-item.json
.slopflow/work/<work-key>/tracked-item.json
.slopflow/work/<work-key>/issue.md
.slopflow/work/<work-key>/contract.md
.slopflow/work/<work-key>/status.json
.slopflow/work/<work-key>/goal-prompt.md
.slopflow/work/<work-key>/next-steps.md
```

`work-item.json` is the one-shot provider intake snapshot. `tracked-item.json` is still written as a legacy compatibility filename. After start, `contract.md` is the local source of truth; Slopflow does not silently synchronize provider edits into existing work.

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
.slopflow/work/<work-key>/evidence/
```

Then it returns the wrapped command’s exit code.

### Coordinate agent attempts

For parallel agent work, Slopflow coordinates **agent attempts** as artifacts and isolated execution workspaces. Core Slopflow does not launch or supervise agents.

Minimal flow:

```bash
slopflow attempt create 42 --count 3
slopflow attempt list 42
slopflow test 42 --attempt a1 --name unit -- npm test
slopflow attempt submit 42 a1
slopflow attempt compare 42
slopflow attempt select 42 a1 --reason "best evidence and smallest diff"
slopflow attempt promote 42
```

Promotion is artifact-only: it does not merge, cherry-pick, apply patches, push, publish, approve review, or complete work. See [Agent attempts](docs/attempts.md) for the full attempt lifecycle, artifact layout, selected execution workspace rules, and abandon flow.

### Prepare review

```bash
slopflow review 42
```

`review` writes:

```text
.slopflow/work/<work-key>/review-packet.md
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
  current-vcs-state: zsuskvpx 5a9ba73d main* | Add feature
  next-step: slopflow start <provider-native-id>
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
  next-step: install glab or continue if GitLab issue intake is not needed
checks[...]:
  core.node: passed node v26.1.0 satisfies >=24
  core.vcs-tool: passed jj executable found
  recommended.jj: passed jj executable found
  recommended.glab: warn glab executable missing; GitLab issue intake may fail
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
slopflow install --harness pi|omp|claude-code|generic [--yes] [--force]
slopflow skill lint
slopflow start <provider-native-id> [--provider <provider> --repository <owner/name> --base-url <url> --kind issue --id <id>]
slopflow attempt create <work-key-or-provider-native-id> [--count <n>]
slopflow attempt list <work-key-or-provider-native-id>
slopflow attempt status <work-key-or-provider-native-id> [attempt-id]
slopflow attempt submit <work-key-or-provider-native-id> <attempt-id>
slopflow attempt abandon <work-key-or-provider-native-id> <attempt-id> --reason <text>
slopflow attempt compare <work-key-or-provider-native-id>
slopflow attempt select <work-key-or-provider-native-id> <attempt-id> --reason <text>
slopflow attempt promote <work-key-or-provider-native-id>
slopflow pause <work-key-or-provider-native-id> --reason <text>
slopflow resume <work-key-or-provider-native-id>
slopflow cancel <work-key-or-provider-native-id> --reason <text>
slopflow test <work-key-or-provider-native-id> --name <gate> -- <command...>
slopflow test <work-key-or-provider-native-id> --attempt <attempt-id> --name <gate> -- <command...>
slopflow review <work-key-or-provider-native-id>
slopflow complete <work-key-or-provider-native-id>
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

import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const hasJj = run(["jj", "--version"], process.cwd()).status === 0;
const requiresJj = { skip: !hasJj };

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "slopflow-test-"));
  const repo = join(dir, "repo");
  mkdirSync(repo);
  run(["git", "init", "-q"], repo, true);
  run(["git", "remote", "add", "origin", "https://github.com/aivv73/slopflow.git"], repo, true);
  writeFileSync(join(repo, "package.json"), JSON.stringify({ engines: { node: ">=24" } }), "utf8");
  run(["jj", "git", "init", "--colocate"], repo, true);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const ghPath = join(bin, "gh");
  writeFileSync(
    ghPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("gh version 0.0.0-test");
  process.exit(0);
}
const kind = args[0];
const number = Number(args[2]);
if (kind === "issue" && args[1] === "view" && number === 2) {
  console.log(JSON.stringify({
    number: 2,
    title: "Implement slopflow start bootstrap",
    body: "## Acceptance Criteria\\n\\n- Create work directory\\n- Write contract\\n\\n## Out of Scope\\n\\n- Complete work",
    url: "https://github.com/aivv73/slopflow/issues/2",
    state: "OPEN"
  }));
  process.exit(0);
}
if (kind === "issue" && args[1] === "view" && number === 3) {
  console.log("{not-json");
  process.exit(0);
}
if (kind === "issue" && args[1] === "view" && number === 4) {
  process.stderr.write("authentication required: run gh auth login\\n");
  process.exit(4);
}
process.stderr.write("not found\\n");
process.exit(1);
`,
  );
  chmodSync(ghPath, 0o755);
  const ghAxiPath = join(bin, "gh-axi");
  writeFileSync(ghAxiPath, "#!/bin/sh\necho 'gh-axi 0.0.0-test'\n", "utf8");
  chmodSync(ghAxiPath, 0o755);
  return { dir, repo, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } };
}

function makeGitRepo() {
  const dir = mkdtempSync(join(tmpdir(), "slopflow-git-test-"));
  const repo = join(dir, "repo");
  mkdirSync(repo);
  run(["git", "init", "-q"], repo, true);
  run(["git", "remote", "add", "origin", "https://github.com/aivv73/slopflow.git"], repo, true);
  writeFileSync(join(repo, "package.json"), JSON.stringify({ engines: { node: ">=24" } }), "utf8");
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const ghPath = join(bin, "gh");
  writeFileSync(
    ghPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("gh version 0.0.0-test");
  process.exit(0);
}
if (args[0] === "issue" && args[1] === "view" && Number(args[2]) === 2) {
  console.log(JSON.stringify({ number: 2, title: "Git issue", body: "- Do work", url: "https://github.com/aivv73/slopflow/issues/2", state: "OPEN" }));
  process.exit(0);
}
process.stderr.write("not found\\n");
process.exit(1);
`,
  );
  chmodSync(ghPath, 0o755);
  const ghAxiPath = join(bin, "gh-axi");
  writeFileSync(ghAxiPath, "#!/bin/sh\necho 'gh-axi 0.0.0-test'\n", "utf8");
  chmodSync(ghAxiPath, 0o755);
  return { dir, repo, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } };
}

function run(args, cwd, check = false, env = process.env) {
  const result = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8", env });
  if (check && result.status !== 0) {
    throw new Error(`${args.join(" ")} failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
  return result;
}

function slopflow(repo, env, ...args) {
  return run([process.execPath, cliPath, ...args], repo, false, env);
}

function parseJsonOutput(result) {
  assert.equal(result.stderr, "");
  assert.doesNotThrow(() => JSON.parse(result.stdout), result.stdout);
  return JSON.parse(result.stdout);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function withRepo(fn) {
  return async () => {
    const { dir, repo, env } = makeRepo();
    try {
      await fn(repo, env);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

function withGitRepo(fn) {
  return async (t) => {
    const { dir, repo, env } = makeGitRepo();
    try {
      await fn(repo, env, t);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

function workDirFor(repo, issueId = "2") {
  const workRoot = join(repo, ".slopflow", "work");
  for (const entry of readdirSync(workRoot)) {
    const statusPath = join(workRoot, entry, "status.json");
    if (!existsSync(statusPath)) continue;
    const status = JSON.parse(readFileSync(statusPath, "utf8"));
    if (status.work_key === issueId || status.issue?.id === issueId || String(status.issue?.number) === issueId) {
      return join(workRoot, entry);
    }
  }
  return join(workRoot, issueId);
}

function githubIssue2WorkKey() {
  return "github-aivv73-slopflow-issue-2-7335e961";
}

function writeReview(repo, issueId, overrides = {}) {
  writeFileSync(join(workDirFor(repo, issueId), "review.json"), JSON.stringify({
    schema_version: 1,
    verdict: "complete",
    reviewer: "pi-reviewer",
    reviewed_at: new Date().toISOString(),
    summary: "Looks good.",
    required_changes: [],
    ...overrides,
  }), "utf8");
}

function writeProjectDocs(repo) {
  mkdirSync(join(repo, "docs", "agents"), { recursive: true });
  mkdirSync(join(repo, "docs", "adr"), { recursive: true });
  writeFileSync(join(repo, "docs", "agents", "issue-tracker.md"), "---\ntype: Agent Configuration\n---\n# Issue tracker\n", "utf8");
  writeFileSync(join(repo, "docs", "agents", "triage-labels.md"), "---\ntype: Agent Configuration\n---\n# Triage labels\n", "utf8");
  writeFileSync(join(repo, "docs", "agents", "domain.md"), "---\ntype: Agent Configuration\n---\n# Domain\n", "utf8");
  writeFileSync(join(repo, "CONTEXT.md"), "# Context\n", "utf8");
}

function writeSkillFixtures(repo, { failing = false } = {}) {
  mkdirSync(join(repo, "skills", "slopflow"), { recursive: true });
  mkdirSync(join(repo, "skills", "slopflow-live"), { recursive: true });
  mkdirSync(join(repo, "skills", "setup-slopflow-skills"), { recursive: true });
  writeFileSync(join(repo, "skills", "slopflow", "SKILL.md"), failing
    ? "# Slopflow\n\n!`slopflow status`\n"
    : "# Slopflow\n\nThe Slopflow CLI output and `.slopflow/work/<issue-id>/` artifacts are canonical.\n\nDo not manually fabricate test evidence, review verdicts, completion notes, or status metadata.\n\nDo not push, merge, publish, create a pull request, or close an issue unless explicitly requested.\n", "utf8");
  writeFileSync(join(repo, "skills", "slopflow-live", "SKILL.md"), failing
    ? "# Slopflow Live\n\n- status: !`slopflow start 1`\n"
    : "# Slopflow Live\n\n- status: !`slopflow status 2>&1 || true`\n\nThe Slopflow CLI output and `.slopflow/work/<issue-id>/` artifacts are canonical.\n\nDo not manually fabricate test evidence, review verdicts, completion notes, or status metadata.\n\nDo not push, merge, publish, create a pull request, or close an issue unless explicitly requested.\n", "utf8");
  writeFileSync(join(repo, "skills", "setup-slopflow-skills", "domain.md"), failing
    ? "# Domain\n"
    : "---\ntype: Agent Configuration\n---\n# Domain\n", "utf8");
}

test("init creates machine config and work root", requiresJj, withRepo((repo, env) => {
  const result = slopflow(repo, env, "init");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /init:/);
  assert.match(result.stdout, /status: created/);
  assert.match(result.stdout, /repo: aivv73\/slopflow/);
  assert.match(result.stdout, /artifact-root: \.slopflow\/work/);
  assert.match(result.stdout, /next-step: slopflow status/);

  const config = JSON.parse(readFileSync(join(repo, ".slopflow", "config.json"), "utf8"));
  assert.deepEqual(config, {
    schema_version: 1,
    artifact_root: ".slopflow/work",
    workspace_root: ".slopflow-workspaces",
    issue_tracker: {
      provider: "github",
      repository: "aivv73/slopflow",
      base_url: "https://github.com",
      prs_as_request_surface: true,
    },
    vcs: { type: "jj" },
  });
}));

test("init supports plain Git repositories and recommends jj", withGitRepo((repo, env) => {
  const result = slopflow(repo, env, "init");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /vcs: git/);
  assert.match(result.stdout, /Jujutsu \(jj\) is recommended/);

  const config = JSON.parse(readFileSync(join(repo, ".slopflow", "config.json"), "utf8"));
  assert.equal(config.vcs.type, "git");
  assert.equal(existsSync(join(repo, ".slopflow", "work")), true);
}));

test("start and status work in plain Git repositories", withGitRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);

  const start = slopflow(repo, env, "start", "2");
  assert.equal(start.status, 0, start.stderr);
  assert.match(start.stdout, /status: created/);

  const status = slopflow(repo, env, "status");
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /vcs: git/);
  assert.match(status.stdout, /current-vcs-state:/);
  assert.doesNotMatch(status.stdout, /current-jj-change:/);
}));

test("init is idempotent for matching config", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  const second = slopflow(repo, env, "init");
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /status: unchanged/);
}));

test("init refuses incompatible config without force", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  const configPath = join(repo, ".slopflow", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.artifact_root = ".elsewhere/work";
  writeFileSync(configPath, JSON.stringify(config), "utf8");

  const blocked = slopflow(repo, env, "init");
  assert.equal(blocked.status, 2);
  assert.match(blocked.stdout, /status: blocked/);
  assert.match(blocked.stdout, /differs from detected config/);
  assert.match(blocked.stdout, /slopflow init --force/);
}));

test("init force refreshes incompatible config", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  const configPath = join(repo, ".slopflow", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.artifact_root = ".elsewhere/work";
  writeFileSync(configPath, JSON.stringify(config), "utf8");

  const forced = slopflow(repo, env, "init", "--force");
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(forced.stdout, /status: reinitialized/);
  assert.equal(JSON.parse(readFileSync(configPath, "utf8")).artifact_root, ".slopflow/work");
}));

test("init detects repo root from subdirectory", requiresJj, withRepo((repo, env) => {
  const subdir = join(repo, "nested", "path");
  mkdirSync(subdir, { recursive: true });

  const result = slopflow(subdir, env, "init");
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotThrow(() => readFileSync(join(repo, ".slopflow", "config.json")));
}));

test("install minimal is replaced by init", requiresJj, withRepo((repo, env) => {
  const result = slopflow(repo, env, "install", "minimal");

  assert.equal(result.status, 2);
  assert.match(result.stdout, /status: blocked/);
  assert.match(result.stdout, /install minimal.*replaced by `slopflow init`/);
  assert.match(result.stdout, /slopflow init/);
}));

test("install requires explicit harness in non-interactive mode", requiresJj, withRepo((repo, env) => {
  const result = slopflow(repo, env, "install");

  assert.equal(result.status, 2);
  assert.match(result.stdout, /Missing harness selection/);
  assert.match(result.stdout, /slopflow install --harness pi\|omp\|claude-code\|generic/);
}));

test("install pi dry-run prints project-local workflow pack plan without writing", requiresJj, withRepo((repo, env) => {
  const result = slopflow(repo, env, "install", "--harness", "pi");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /install:/);
  assert.match(result.stdout, /status: planned/);
  assert.match(result.stdout, /harness: pi/);
  assert.match(result.stdout, /mode: dry-run/);
  assert.match(result.stdout, /skills: \.pi\/skills/);
  assert.match(result.stdout, /extensions: \.pi\/extensions/);
  assert.match(result.stdout, /agents: \.pi\/agents/);
  assert.match(result.stdout, /settings: \.pi\/settings\.json/);
  assert.match(result.stdout, /packages: 3/);
  assert.match(result.stdout, /writes: none/);
  assert.match(result.stdout, /next-step: slopflow install --harness pi --yes/);
  assert.equal(existsSync(join(repo, ".pi", "skills", "slopflow-live", "SKILL.md")), false);
  assert.equal(existsSync(join(repo, ".pi", "settings.json")), false);
  assert.equal(existsSync(join(repo, ".pi", "extensions", "slopflow", "index.ts")), false);
}));

test("install pi --yes writes local extensions live skills and agent roles", requiresJj, withRepo((repo, env) => {
  const result = slopflow(repo, env, "install", "--harness", "pi", "--yes");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /status: applied/);
  assert.match(result.stdout, /harness: pi/);
  assert.match(result.stdout, /writes: project-local/);
  assert.equal(existsSync(join(repo, ".pi", "skills", "slopflow-live", "SKILL.md")), true);
  assert.equal(existsSync(join(repo, ".pi", "skills", "setup-slopflow-skills-live", "SKILL.md")), true);
  const extension = readFileSync(join(repo, ".pi", "extensions", "slopflow", "index.ts"), "utf8");
  assert.match(extension, /slopflow-create-goal/);
  assert.match(extension, /\/create-goal /);
  assert.match(extension, /slopflow", \["start", issueId\]/);
  const settings = JSON.parse(readFileSync(join(repo, ".pi", "settings.json"), "utf8"));
  assert.deepEqual(settings.packages, [
    "git:github.com/joelhooks/pi-skill-interpolation",
    "npm:@tintinweb/pi-subagents",
    "npm:pi-codex-goal",
  ]);
  assert.equal(settings.packages.includes("npm:@howaboua/pi-codex-conversion"), false);
  const planner = readFileSync(join(repo, ".pi", "agents", "slopflow-planner.md"), "utf8");
  const executor = readFileSync(join(repo, ".pi", "agents", "slopflow-executor.md"), "utf8");
  const reviewer = readFileSync(join(repo, ".pi", "agents", "slopflow-reviewer.md"), "utf8");
  const liveSkill = readFileSync(join(repo, ".pi", "skills", "slopflow-live", "SKILL.md"), "utf8");
  assert.match(planner, /tools: read, grep, find, bash, ls/);
  assert.match(planner, /skills: slopflow-live/);
  assert.match(planner, /prompt_mode: replace/);
  assert.doesNotMatch(planner, /name: slopflow-planner/);
  assert.match(executor, /tools: "\*"/);
  assert.match(executor, /prompt_mode: append/);
  assert.match(reviewer, /thinking: high/);
  assert.match(reviewer, /max_turns: 25/);
  assert.match(liveSkill, /canonical repository/);
  assert.match(liveSkill, /execution workspace/);
  assert.match(liveSkill, /\.slopflow-attempt\.json/);
  assert.match(liveSkill, /artifact-only/);
  assert.match(liveSkill, /Do not manually fabricate attempt artifacts/);
}));

test("install pi merges existing project settings packages", requiresJj, withRepo((repo, env) => {
  mkdirSync(join(repo, ".pi"), { recursive: true });
  writeFileSync(join(repo, ".pi", "settings.json"), JSON.stringify({ packages: ["npm:existing-pkg"], enableSkillCommands: true }, null, 2), "utf8");

  const result = slopflow(repo, env, "install", "--harness", "pi", "--yes");

  assert.equal(result.status, 0, result.stderr);
  const settings = JSON.parse(readFileSync(join(repo, ".pi", "settings.json"), "utf8"));
  assert.equal(settings.enableSkillCommands, true);
  assert.deepEqual(settings.packages, [
    "npm:existing-pkg",
    "git:github.com/joelhooks/pi-skill-interpolation",
    "npm:@tintinweb/pi-subagents",
    "npm:pi-codex-goal",
  ]);
  assert.equal(settings.packages.includes("npm:@howaboua/pi-codex-conversion"), false);
}));


test("install omp dry-run prints native profile plan without writing", requiresJj, withRepo((repo, env) => {
  const result = slopflow(repo, env, "install", "--harness", "omp");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /status: planned/);
  assert.match(result.stdout, /harness: omp/);
  assert.match(result.stdout, /skills: \.omp\/skills/);
  assert.match(result.stdout, /commands: \.omp\/commands/);
  assert.match(result.stdout, /skill-interpolation: git:github\.com\/joelhooks\/pi-skill-interpolation/);
  assert.match(result.stdout, /native-subagents: task/);
  assert.match(result.stdout, /native-goal: goal/);
  assert.match(result.stdout, /writes: none/);
  assert.match(result.stdout, /next-step: slopflow install --harness omp --yes/);
  assert.equal(existsSync(join(repo, ".omp", "skills", "slopflow-live", "SKILL.md")), false);
  assert.equal(existsSync(join(repo, ".omp", "commands", "slopflow-create-goal.md")), false);
  assert.equal(existsSync(join(repo, ".pi", "settings.json")), false);
}));

test("install omp --yes writes native skills and goal command", requiresJj, withRepo((repo, env) => {
  const result = slopflow(repo, env, "install", "--harness=omp", "--yes");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /status: applied/);
  assert.match(result.stdout, /harness: omp/);
  assert.match(result.stdout, /skill-interpolation: git:github\.com\/joelhooks\/pi-skill-interpolation/);
  assert.match(result.stdout, /native-subagents: task/);
  assert.match(result.stdout, /native-goal: goal/);
  assert.equal(existsSync(join(repo, ".omp", "skills", "slopflow-live", "SKILL.md")), true);
  assert.equal(existsSync(join(repo, ".omp", "skills", "setup-slopflow-skills-live", "SKILL.md")), true);
  const command = readFileSync(join(repo, ".omp", "commands", "slopflow-create-goal.md"), "utf8");
  assert.match(command, /\/goal set <goal prompt content>/);
  assert.match(command, /OMP native primitives/);
  assert.match(command, /task/);
  assert.match(command, /git:github\.com\/joelhooks\/pi-skill-interpolation/);
  assert.doesNotMatch(command, /npm:@howaboua\/pi-codex-conversion/);
  assert.equal(existsSync(join(repo, ".pi", "settings.json")), false);
}));
test("install claude-code --yes writes local live skills", requiresJj, withRepo((repo, env) => {
  const result = slopflow(repo, env, "install", "--harness=claude-code", "--yes");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /harness: claude-code/);
  assert.equal(existsSync(join(repo, ".claude", "skills", "slopflow-live", "SKILL.md")), true);
  assert.equal(existsSync(join(repo, ".claude", "skills", "setup-slopflow-skills-live", "SKILL.md")), true);
  assert.equal(existsSync(join(repo, ".pi")), false);
}));

test("install generic --yes writes portable agent skills", requiresJj, withRepo((repo, env) => {
  const result = slopflow(repo, env, "install", "--harness", "generic", "--yes");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /harness: generic/);
  assert.match(result.stdout, /live-skills: skipped/);
  assert.equal(existsSync(join(repo, ".agents", "skills", "slopflow", "SKILL.md")), true);
  assert.equal(existsSync(join(repo, ".agents", "skills", "setup-slopflow-skills", "SKILL.md")), true);
  const skill = readFileSync(join(repo, ".agents", "skills", "slopflow", "SKILL.md"), "utf8");
  assert.match(skill, /slopflow test <issue-id> --attempt <attempt-id> --name <gate> -- <command\.\.\.>/);
  assert.match(skill, /slopflow attempt compare <issue-id>/);
  assert.match(skill, /slopflow attempt select <issue-id> <attempt-id> --reason/);
  assert.match(skill, /slopflow attempt promote <issue-id>/);
  assert.match(skill, /canonical repository/);
  assert.match(skill, /execution workspace/);
  assert.match(skill, /artifact-only/);
  assert.match(skill, /canonical run/);
  assert.equal(existsSync(join(repo, ".claude")), false);
}));

test("install harness is idempotent for matching pack files", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "install", "--harness", "generic", "--yes").status, 0);

  const second = slopflow(repo, env, "install", "--harness", "generic", "--yes");

  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /status: unchanged/);
  assert.match(second.stdout, /written-count: 0/);
}));

test("install harness blocks conflicting pack files unless forced", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "install", "--harness", "generic", "--yes").status, 0);
  const skillPath = join(repo, ".agents", "skills", "slopflow", "SKILL.md");
  writeFileSync(skillPath, "locally changed\n", "utf8");

  const blocked = slopflow(repo, env, "install", "--harness", "generic", "--yes");
  assert.equal(blocked.status, 2);
  assert.match(blocked.stdout, /Existing harness workflow pack file differs/);
  assert.match(blocked.stdout, /slopflow install --harness generic --yes --force/);

  const forced = slopflow(repo, env, "install", "--harness", "generic", "--yes", "--force");
  assert.equal(forced.status, 0, forced.stdout);
  assert.match(forced.stdout, /overwrite-count: 1/);
  assert.match(readFileSync(skillPath, "utf8"), /name: slopflow/);
}));

test("skill lint passes valid Slopflow skill fixtures", requiresJj, withRepo((repo, env) => {
  writeSkillFixtures(repo);

  const result = slopflow(repo, env, "skill", "lint");

  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /skill-lint:/);
  assert.match(result.stdout, /status: passed/);
  assert.match(result.stdout, /failed-count: 0/);
  assert.match(result.stdout, /slopflow.no-interpolation: passed/);
  assert.match(result.stdout, /slopflow-live.read-only-interpolation: passed/);
  assert.match(result.stdout, /setup-template.setup-slopflow-skills\/domain.md: passed/);
}));

test("skill lint fails unsafe synthetic skill fixtures", requiresJj, withRepo((repo, env) => {
  writeSkillFixtures(repo, { failing: true });

  const result = slopflow(repo, env, "skill", "lint");

  assert.equal(result.status, 2);
  assert.match(result.stdout, /skill-lint:/);
  assert.match(result.stdout, /status: failed/);
  assert.match(result.stdout, /slopflow.no-interpolation: failed portable skill contains shell interpolation/);
  assert.match(result.stdout, /slopflow-live.read-only-interpolation: failed interpolation includes mutating command/);
  assert.match(result.stdout, /setup-template.setup-slopflow-skills\/domain.md: failed missing OKF frontmatter type/);
  assert.match(result.stdout, /next-step: fix failing skill checks/);
}));

test("status reports config, jj change, active work count, and next step", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  mkdirSync(join(repo, ".slopflow", "work", "1"), { recursive: true });

  const result = slopflow(repo, env, "status");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /status:/);
  assert.match(result.stdout, /state: initialized/);
  assert.match(result.stdout, /repo: aivv73\/slopflow/);
  assert.match(result.stdout, /issue_tracker: github/);
  assert.match(result.stdout, /vcs: jj/);
  assert.match(result.stdout, /artifact-root: \.slopflow\/work/);
  assert.match(result.stdout, /current-jj-change:/);
  assert.match(result.stdout, /active-work-count: 1/);
  assert.match(result.stdout, /next-step: slopflow start <issue-id>/);
}));

test("status --json returns valid JSON with status fields", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  mkdirSync(join(repo, ".slopflow", "work", "1"), { recursive: true });

  const result = slopflow(repo, env, "status", "--json");
  const payload = parseJsonOutput(result);

  assert.equal(result.status, 0);
  assert.equal(payload.status.state, "initialized");
  assert.equal(payload.status.repo, "aivv73/slopflow");
  assert.equal(payload.status.issue_tracker, "github");
  assert.equal(payload.status.vcs, "jj");
  assert.equal(payload.status["active-work-count"], 1);
  assert.equal(payload.status["next-step"], "slopflow start <issue-id>");
}));

test("status blocks before init", requiresJj, withRepo((repo, env) => {
  const result = slopflow(repo, env, "status");
  assert.equal(result.status, 2);
  assert.match(result.stdout, /status: blocked/);
  assert.match(result.stdout, /Run `slopflow init` first/);
}));

test("status --json returns structured JSON errors", requiresJj, withRepo((repo, env) => {
  const result = slopflow(repo, env, "status", "--json");
  const payload = parseJsonOutput(result);

  assert.equal(result.status, 2);
  assert.equal(payload.error.status, "blocked");
  assert.equal(payload.error.message, "Slopflow machine config is missing.");
  assert.equal(payload.error.hint, "Run `slopflow init` first.");
}));

test("doctor reports initialized repository readiness", requiresJj, withRepo((repo, env) => {
  writeProjectDocs(repo);
  assert.equal(slopflow(repo, env, "init").status, 0);

  const result = slopflow(repo, env, "doctor");

  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /doctor:/);
  assert.match(result.stdout, /status: passed/);
  assert.match(result.stdout, /core: passed/);
  assert.match(result.stdout, /project-docs: passed/);
  assert.match(result.stdout, /recommended: passed/);
  assert.match(result.stdout, /failed-count: 0/);
  assert.match(result.stdout, /warning-count: 0/);
  assert.match(result.stdout, /next-step: slopflow start <issue-id>/);
  assert.match(result.stdout, /checks\[/);
  assert.match(result.stdout, /core.node: passed node v.* satisfies >=24/);
  assert.match(result.stdout, /core.config: passed/);
  assert.match(result.stdout, /recommended.gh: passed/);
  assert.match(result.stdout, /recommended.gh-axi: passed gh-axi executable found/);
}));

test("doctor --json returns valid JSON with doctor fields and checks", requiresJj, withRepo((repo, env) => {
  writeProjectDocs(repo);
  assert.equal(slopflow(repo, env, "init").status, 0);

  const result = slopflow(repo, env, "doctor", "--json");
  const payload = parseJsonOutput(result);

  assert.equal(result.status, 0);
  assert.equal(payload.doctor.status, "passed");
  assert.equal(payload.doctor.core, "passed");
  assert.equal(payload.doctor["project-docs"], "passed");
  assert.equal(payload.doctor.recommended, "passed");
  assert.equal(payload.doctor["failed-count"], 0);
  assert.equal(payload.doctor["warning-count"], 0);
  assert.match(payload.checks["core.node"], /^passed node v/);
  assert.equal(payload.checks["recommended.gh-axi"], "passed gh-axi executable found");
}));

test("doctor fails before initialization and suggests init", requiresJj, withRepo((repo, env) => {
  const result = slopflow(repo, env, "doctor");

  assert.equal(result.status, 2);
  assert.match(result.stdout, /doctor:/);
  assert.match(result.stdout, /status: failed/);
  assert.match(result.stdout, /core: failed/);
  assert.match(result.stdout, /core.config: failed \.slopflow\/config\.json missing/);
  assert.match(result.stdout, /core.work-root: failed \.slopflow\/work missing/);
  assert.match(result.stdout, /next-step: slopflow init/);
}));

test("doctor warns when optional gh tool is missing", requiresJj, withRepo((repo, env) => {
  writeProjectDocs(repo);
  assert.equal(slopflow(repo, env, "init").status, 0);
  const bin = mkdtempSync(join(tmpdir(), "slopflow-doctor-bin-"));
  const jjPath = join(bin, "jj");
  writeFileSync(jjPath, "#!/bin/sh\necho 'jj 0.0.0-test'\n", "utf8");
  chmodSync(jjPath, 0o755);

  const result = slopflow(repo, { ...env, PATH: bin }, "doctor");

  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /status: warn/);
  assert.match(result.stdout, /core: passed/);
  assert.match(result.stdout, /recommended: warn/);
  assert.match(result.stdout, /recommended.gh: warn gh executable missing/);
  assert.match(result.stdout, /recommended.gh-axi: warn unchecked/);
  assert.match(result.stdout, /next-step: install gh or continue if GitHub issue intake is not needed/);
}));

test("doctor checks only configured GitLab intake dependency", requiresJj, withRepo((repo, env) => {
  writeProjectDocs(repo);
  assert.equal(slopflow(repo, env, "init").status, 0);
  const configPath = join(repo, ".slopflow", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.issue_tracker = {
    provider: "gitlab",
    repository: "group/project",
    base_url: "https://gitlab.example.com",
    prs_as_request_surface: true,
  };
  writeFileSync(configPath, JSON.stringify(config), "utf8");
  const bin = mkdtempSync(join(tmpdir(), "slopflow-doctor-gitlab-bin-"));
  const jjPath = join(bin, "jj");
  writeFileSync(jjPath, "#!/bin/sh\necho 'jj 0.0.0-test'\n", "utf8");
  chmodSync(jjPath, 0o755);

  const result = slopflow(repo, { ...env, PATH: bin }, "doctor");

  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /recommended.glab: warn glab executable missing/);
  assert.doesNotMatch(result.stdout, /recommended.gh:/);
  assert.match(result.stdout, /next-step: install glab or continue if GitLab issue intake is not needed/);
}));

test("doctor warns for unsupported configured issue tracker provider", requiresJj, withRepo((repo, env) => {
  writeProjectDocs(repo);
  assert.equal(slopflow(repo, env, "init").status, 0);
  const configPath = join(repo, ".slopflow", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.issue_tracker = {
    provider: "forgejo",
    repository: "owner/project",
    base_url: "https://code.example.com",
    prs_as_request_surface: true,
  };
  writeFileSync(configPath, JSON.stringify(config), "utf8");

  const result = slopflow(repo, env, "doctor");

  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /recommended.forgejo: warn unsupported issue tracker provider: forgejo/);
}));

test("no-args home view reports uninitialized repository", requiresJj, withRepo((repo, env) => {
  const result = slopflow(repo, env);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /slopflow:/);
  assert.match(result.stdout, /bin:/);
  assert.match(result.stdout, /description: Controlled issue execution for AI coding agents\./);
  assert.match(result.stdout, /state: uninitialized/);
  assert.match(result.stdout, /repo-root:/);
  assert.match(result.stdout, /vcs: jj/);
  assert.match(result.stdout, /next-step: slopflow init/);
}));

test("no-args home view reports initialized repository state", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  mkdirSync(join(repo, ".slopflow", "work", "1"), { recursive: true });

  const result = slopflow(repo, env);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /slopflow:/);
  assert.match(result.stdout, /bin:/);
  assert.match(result.stdout, /description: Controlled issue execution for AI coding agents\./);
  assert.match(result.stdout, /state: initialized/);
  assert.match(result.stdout, /repo: aivv73\/slopflow/);
  assert.match(result.stdout, /issue_tracker: github/);
  assert.match(result.stdout, /vcs: jj/);
  assert.match(result.stdout, /artifact-root: \.slopflow\/work/);
  assert.match(result.stdout, /current-jj-change:/);
  assert.match(result.stdout, /active-work-count: 1/);
  assert.match(result.stdout, /next-step: slopflow start <issue-id>/);
}));

test("help flag prints concise command reference", () => {
  const result = run([process.execPath, cliPath, "--help"], process.cwd());

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: slopflow <command>/);
  assert.match(result.stdout, /Commands:/);
  assert.match(result.stdout, /status/);
  assert.match(result.stdout, /attempt create <issue-id>/);
  assert.match(result.stdout, /attempt compare <issue-id>/);
  assert.match(result.stdout, /attempt promote <issue-id>/);
  assert.match(result.stdout, /test <issue-id> --attempt <attempt-id> --name <gate> -- <command\.\.\.>/);
  assert.match(result.stdout, /complete <issue-id>/);
});

test("unknown commands return structured error and nonzero exit", requiresJj, withRepo((repo, env) => {
  const result = slopflow(repo, env, "bogus");

  assert.equal(result.status, 2);
  assert.match(result.stdout, /error:/);
  assert.match(result.stdout, /status: blocked/);
  assert.match(result.stdout, /Unknown command: bogus/);
  assert.match(result.stdout, /slopflow --help/);
  assert.equal(result.stderr, "");
}));

test("start creates bootstrap artifacts for a GitHub issue", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);

  const result = slopflow(repo, env, "start", "2");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /start:/);
  assert.match(result.stdout, /status: created/);
  assert.match(result.stdout, /issue: github:aivv73\/slopflow issue 2/);
  assert.match(result.stdout, /work-directory: \.slopflow\/work\/github-aivv73-slopflow-issue-2-7335e961/);
  assert.match(result.stdout, /contract: \.slopflow\/work\/github-aivv73-slopflow-issue-2-7335e961\/contract.md/);
  assert.match(result.stdout, /goal-prompt: \.slopflow\/work\/github-aivv73-slopflow-issue-2-7335e961\/goal-prompt.md/);

  const workDir = workDirFor(repo, "2");
  for (const file of ["issue.md", "contract.md", "status.json", "goal-prompt.md", "next-steps.md"]) {
    assert.equal(existsSync(join(workDir, file)), true, `${file} should exist`);
  }
  for (const file of ["review.json", "review.md", "completion-note.md"]) {
    assert.equal(existsSync(join(workDir, file)), false, `${file} should not be placeholder-created`);
  }
  assert.equal(existsSync(join(workDir, "evidence")), false, "evidence directory should not be placeholder-created");

  const status = JSON.parse(readFileSync(join(workDir, "status.json"), "utf8"));
  assert.deepEqual(status.issue, {
    provider: "github",
    base_url: "https://github.com",
    repository: "aivv73/slopflow",
    kind: "issue",
    id: "2",
    url: "https://github.com/aivv73/slopflow/issues/2",
    repo: "aivv73/slopflow",
    number: 2,
  });

  const contract = readFileSync(join(workDir, "contract.md"), "utf8");
  for (const heading of [
    "## Issue Summary",
    "## Acceptance Criteria",
    "## Constraints",
    "## Out of Scope",
    "## Required Quality Gates",
    "## Blocked-Stop Conditions",
    "## Completion Criteria",
  ]) {
    assert.match(contract, new RegExp(heading));
  }
  assert.match(readFileSync(join(workDir, "goal-prompt.md"), "utf8"), /contract is canonical/i);
}));

test("start is idempotent for matching work directory", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);

  const second = slopflow(repo, env, "start", "2");

  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /status: unchanged/);
}));

test("start accepts explicit provider issue reference flags", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);

  const result = slopflow(repo, env, "start", "--provider", "github", "--repository", "aivv73/slopflow", "--base-url", "HTTPS://github.com/", "--kind", "issue", "--id", "2");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /issue: github:aivv73\/slopflow issue 2/);
  const status = JSON.parse(readFileSync(join(workDirFor(repo, "2"), "status.json"), "utf8"));
  assert.equal(status.issue.base_url, "https://github.com");
  assert.equal(status.issue.id, "2");
}));

test("start blocks unsupported explicit tracked item kinds", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);

  const result = slopflow(repo, env, "start", "--provider", "github", "--repository", "aivv73/slopflow", "--kind", "pull_request", "--id", "2");

  assert.equal(result.status, 2);
  assert.match(result.stdout, /Unsupported tracked item kind: pull_request/);
  assert.match(result.stdout, /status: blocked/);
}));

test("start creates GitLab issue work from configured provider", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  const configPath = join(repo, ".slopflow", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.issue_tracker = {
    provider: "gitlab",
    repository: "group/project",
    base_url: "HTTPS://gitlab.example.com/",
    prs_as_request_surface: true,
  };
  writeFileSync(configPath, JSON.stringify(config), "utf8");
  const bin = mkdtempSync(join(tmpdir(), "slopflow-glab-bin-"));
  const glabPath = join(bin, "glab");
  writeFileSync(glabPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
const path = args.at(-1);
if (args[0] === "--version") {
  console.log("glab version 0.0.0-test");
  process.exit(0);
}
if (path === "projects/group%2Fproject/issues/7") {
  console.log(JSON.stringify({ iid: 7, title: "GitLab issue", description: "Do GitLab work", web_url: "https://gitlab.example.com/group/project/-/issues/7", state: "opened", labels: ["backend"] }));
  process.exit(0);
}
if (path === "projects/group%2Fproject/issues/7/notes?per_page=100&order_by=created_at&sort=asc") {
  console.log(JSON.stringify([{ body: "clarifying comment", created_at: "2026-01-01T00:00:00.000Z", author: { username: "maintainer" } }]));
  process.exit(0);
}
process.stderr.write("not found\\n");
process.exit(1);
`, "utf8");
  chmodSync(glabPath, 0o755);

  const result = slopflow(repo, { ...env, PATH: `${bin}:${env.PATH}` }, "start", "7");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /issue: gitlab:group\/project issue 7/);
  const workDir = workDirFor(repo, "7");
  const status = JSON.parse(readFileSync(join(workDir, "status.json"), "utf8"));
  assert.equal(status.issue.provider, "gitlab");
  assert.equal(status.issue.base_url, "https://gitlab.example.com");
  assert.equal(status.issue.id, "7");
  const snapshot = JSON.parse(readFileSync(join(workDir, "tracked-item.json"), "utf8"));
  assert.equal(snapshot.comments[0].body, "clarifying comment");
  assert.deepEqual(snapshot.labels, ["backend"]);
}));

test("lifecycle commands reject ambiguous provider-native issue ids", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  const workRoot = join(repo, ".slopflow", "work");
  const first = join(workRoot, "github-owner-one-issue-2-aaaaaaaa");
  const second = join(workRoot, "gitlab-group-project-issue-2-bbbbbbbb");
  mkdirSync(first, { recursive: true });
  mkdirSync(second, { recursive: true });
  writeFileSync(join(first, "status.json"), JSON.stringify({
    schema_version: 1,
    status: "active",
    work_key: "github-owner-one-issue-2-aaaaaaaa",
    issue: { provider: "github", base_url: "https://github.com", repository: "owner/one", kind: "issue", id: "2" },
  }), "utf8");
  writeFileSync(join(second, "status.json"), JSON.stringify({
    schema_version: 1,
    status: "active",
    work_key: "gitlab-group-project-issue-2-bbbbbbbb",
    issue: { provider: "gitlab", base_url: "https://gitlab.com", repository: "group/project", kind: "issue", id: "2" },
  }), "utf8");

  const result = slopflow(repo, env, "review", "2");

  assert.equal(result.status, 2);
  assert.match(result.stdout, /matches multiple work directories/);
  assert.match(result.stdout, /Use the full Slopflow work key/);
}));

test("start uses the issue work lock and force recovers stale start locks", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  const workLock = join(repo, ".slopflow", "work", githubIssue2WorkKey(), "locks", "work.lock");
  mkdirSync(workLock, { recursive: true });
  writeFileSync(join(workLock, "metadata.json"), JSON.stringify({ created_at: "2026-01-01T00:00:00.000Z" }), "utf8");

  const blocked = slopflow(repo, env, "start", "2");
  assert.equal(blocked.status, 2);
  assert.match(blocked.stdout, /scope: work/);
  assert.match(blocked.stdout, /work\.lock/);

  const forced = slopflow(repo, env, "start", "2", "--force");
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(forced.stdout, /status: created/);
  assert.equal(existsSync(workLock), false);
  assert.equal(existsSync(join(workDirFor(repo, "2"), "status.json")), true);
}));

test("attempt create list and status manage issue-local attempt artifacts", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);

  const created = slopflow(repo, env, "attempt", "create", "2", "--count", "3");

  assert.equal(created.status, 0, created.stderr);
  assert.match(created.stdout, /attempt:/);
  assert.match(created.stdout, /status: created/);
  assert.match(created.stdout, /created-count: 3/);
  assert.match(created.stdout, /attempts: a1,a2,a3/);

  const attemptsRoot = join(workDirFor(repo, "2"), "attempts");
  for (const id of ["a1", "a2", "a3"]) {
    const attempt = JSON.parse(readFileSync(join(attemptsRoot, id, "attempt.json"), "utf8"));
    assert.equal(attempt.issue_id, "2");
    assert.equal(attempt.attempt_id, id);
    assert.equal(attempt.status, "created");
    assert.equal(existsSync(join(attemptsRoot, id, "goal-prompt.md")), true);
    const workspace = JSON.parse(readFileSync(join(attemptsRoot, id, "workspace.json"), "utf8"));
    assert.equal(workspace.kind, "jj-workspace");
    assert.match(workspace.path, new RegExp(`${escapeRegExp(join(dirname(repo), ".slopflow-workspaces"))}.*${id}$`));
    assert.equal(existsSync(workspace.path), true);
    const pointer = JSON.parse(readFileSync(join(workspace.path, ".slopflow-attempt.json"), "utf8"));
    assert.equal(pointer.canonical_repository, repo);
    assert.equal(pointer.issue_id, "2");
    assert.equal(pointer.attempt_id, id);
    assert.equal(existsSync(join(attemptsRoot, id, "summary.md")), false);
  }

  const list = slopflow(repo, env, "attempt", "list", "2");
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /attempts:/);
  assert.match(list.stdout, /count: 3/);
  assert.match(list.stdout, /attempts: a1:created,a2:created,a3:created/);

  const status = slopflow(repo, env, "attempt", "status", "2", "a2");
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /attempt:/);
  assert.match(status.stdout, /status: created/);
  assert.match(status.stdout, /attempt: a2/);
  assert.match(status.stdout, /summary: missing/);
}));

test("attempt create supports configured workspace root and cleans up unsupported vcs failures", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  const configPath = join(repo, ".slopflow", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.workspace_root = ".custom-workspaces";
  writeFileSync(configPath, JSON.stringify(config), "utf8");

  const created = slopflow(repo, env, "attempt", "create", "2");
  assert.equal(created.status, 0, created.stderr);
  const workspace = JSON.parse(readFileSync(join(workDirFor(repo, "2"), "attempts", "a1", "workspace.json"), "utf8"));
  assert.match(workspace.path, new RegExp(`${escapeRegExp(join(dirname(repo), ".custom-workspaces"))}.*a1$`));

  config.vcs.type = "unsupported";
  writeFileSync(configPath, JSON.stringify(config), "utf8");
  const blocked = slopflow(repo, env, "attempt", "create", "2");
  assert.equal(blocked.status, 2);
  assert.match(blocked.stdout, /Unsupported version-control type/);
  assert.equal(existsSync(join(workDirFor(repo, "2"), "attempts", "a2")), false);
}));

test("attempt submit requires summary and abandon preserves artifacts", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  assert.equal(slopflow(repo, env, "attempt", "create", "2", "--count", "2").status, 0);
  const attemptsRoot = join(workDirFor(repo, "2"), "attempts");

  const missing = slopflow(repo, env, "attempt", "submit", "2", "a1");
  assert.equal(missing.status, 2);
  assert.match(missing.stdout, /status: blocked/);
  assert.match(missing.stdout, /reason: missing summary\.md/);
  assert.match(missing.stdout, /slopflow attempt submit 2 a1/);

  writeFileSync(join(attemptsRoot, "a1", "summary.md"), "Implemented attempt a1.\n", "utf8");
  const submitted = slopflow(repo, env, "attempt", "submit", "2", "a1");
  assert.equal(submitted.status, 0, submitted.stderr);
  assert.match(submitted.stdout, /status: submitted/);
  assert.match(submitted.stdout, /next-step: slopflow attempt status 2 a1/);
  assert.equal(JSON.parse(readFileSync(join(attemptsRoot, "a1", "attempt.json"), "utf8")).status, "submitted");

  const abandoned = slopflow(repo, env, "attempt", "abandon", "2", "a2", "--reason", "not worth continuing");
  assert.equal(abandoned.status, 0, abandoned.stderr);
  assert.match(abandoned.stdout, /status: abandoned/);
  assert.match(abandoned.stdout, /artifacts: preserved/);
  const a2 = JSON.parse(readFileSync(join(attemptsRoot, "a2", "attempt.json"), "utf8"));
  assert.equal(a2.status, "abandoned");
  assert.equal(a2.abandon_reason, "not worth continuing");
  assert.match(readFileSync(join(attemptsRoot, "a2", "abandon-note.md"), "utf8"), /not worth continuing/);
}));

test("attempt commands block on artifact locks and require force for stale recovery", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);

  const workLock = join(workDirFor(repo, "2"), "locks", "work.lock");
  mkdirSync(workLock, { recursive: true });
  writeFileSync(join(workLock, "metadata.json"), JSON.stringify({ created_at: "2026-01-01T00:00:00.000Z" }), "utf8");
  const blockedCreate = slopflow(repo, env, "attempt", "create", "2");
  assert.equal(blockedCreate.status, 2);
  assert.match(blockedCreate.stdout, /status: blocked/);
  assert.match(blockedCreate.stdout, /scope: work/);
  assert.match(blockedCreate.stdout, /work\.lock/);
  assert.match(blockedCreate.stdout, /--force if stale/);

  const forcedCreate = slopflow(repo, env, "attempt", "create", "2", "--force");
  assert.equal(forcedCreate.status, 0, forcedCreate.stderr);
  assert.match(forcedCreate.stdout, /attempts: a1/);
  assert.equal(existsSync(workLock), false);

  const attemptDir = join(workDirFor(repo, "2"), "attempts", "a1");
  writeFileSync(join(attemptDir, "summary.md"), "Ready.\n", "utf8");
  const attemptLock = join(attemptDir, "attempt.lock");
  mkdirSync(attemptLock, { recursive: true });
  writeFileSync(join(attemptLock, "metadata.json"), JSON.stringify({ created_at: "2026-01-01T00:00:00.000Z" }), "utf8");

  const blockedSubmit = slopflow(repo, env, "attempt", "submit", "2", "a1");
  assert.equal(blockedSubmit.status, 2);
  assert.match(blockedSubmit.stdout, /scope: attempt/);
  assert.match(blockedSubmit.stdout, /attempt\.lock/);

  const forcedSubmit = slopflow(repo, env, "attempt", "submit", "2", "a1", "--force");
  assert.equal(forcedSubmit.status, 0, forcedSubmit.stderr);
  assert.match(forcedSubmit.stdout, /status: submitted/);
  assert.equal(existsSync(attemptLock), false);

  const selectionLock = join(workDirFor(repo, "2"), "locks", "selection.lock");
  mkdirSync(selectionLock, { recursive: true });
  writeFileSync(join(selectionLock, "metadata.json"), JSON.stringify({ created_at: "2026-01-01T00:00:00.000Z" }), "utf8");

  const blockedSelect = slopflow(repo, env, "attempt", "select", "2", "a1", "--reason", "best submitted attempt");
  assert.equal(blockedSelect.status, 2);
  assert.match(blockedSelect.stdout, /scope: selection/);
  assert.match(blockedSelect.stdout, /selection\.lock/);

  const forcedSelect = slopflow(repo, env, "attempt", "select", "2", "a1", "--reason", "best submitted attempt", "--force");
  assert.equal(forcedSelect.status, 0, forcedSelect.stderr);
  assert.match(forcedSelect.stdout, /status: selected/);
  assert.equal(existsSync(selectionLock), false);
  const selection = JSON.parse(readFileSync(join(workDirFor(repo, "2"), "selection.json"), "utf8"));
  assert.equal(selection.selected_attempt_id, "a1");
  assert.equal(JSON.parse(readFileSync(join(attemptDir, "attempt.json"), "utf8")).status, "selected");
}));

test("canonical issue artifact mutations use the issue work lock", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  const workLock = join(workDirFor(repo, "2"), "locks", "work.lock");
  mkdirSync(workLock, { recursive: true });
  writeFileSync(join(workLock, "metadata.json"), JSON.stringify({ created_at: "2026-01-01T00:00:00.000Z" }), "utf8");

  const blockedTest = slopflow(repo, env, "test", "2", "--name", "unit", "--", process.execPath, "-e", "process.exit(0)");
  assert.equal(blockedTest.status, 2);
  assert.match(blockedTest.stdout, /scope: work/);
  assert.match(blockedTest.stdout, /work\.lock/);

  const forcedTest = slopflow(repo, env, "test", "2", "--force", "--name", "unit", "--", process.execPath, "-e", "process.exit(0)");
  assert.equal(forcedTest.status, 0, forcedTest.stderr);
  assert.equal(existsSync(workLock), false);

  mkdirSync(workLock, { recursive: true });
  const blockedReview = slopflow(repo, env, "review", "2");
  assert.equal(blockedReview.status, 2);
  assert.match(blockedReview.stdout, /scope: work/);
  const forcedReview = slopflow(repo, env, "review", "2", "--force");
  assert.equal(forcedReview.status, 0, forcedReview.stderr);
  assert.equal(existsSync(workLock), false);

  mkdirSync(workLock, { recursive: true });
  const blockedPause = slopflow(repo, env, "pause", "2", "--reason", "waiting");
  assert.equal(blockedPause.status, 2);
  assert.match(blockedPause.stdout, /scope: work/);
  const forcedPause = slopflow(repo, env, "pause", "2", "--reason", "waiting", "--force");
  assert.equal(forcedPause.status, 0, forcedPause.stderr);
  assert.equal(existsSync(workLock), false);
}));

test("start refuses existing work directory without status metadata", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  mkdirSync(join(repo, ".slopflow", "work", githubIssue2WorkKey()), { recursive: true });

  const result = slopflow(repo, env, "start", "2");

  assert.equal(result.status, 2);
  assert.match(result.stdout, /status: blocked/);
  assert.match(result.stdout, /already exists without status metadata/);
}));

test("start refuses existing work directory for a different issue reference", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  const workDir = join(repo, ".slopflow", "work", githubIssue2WorkKey());
  mkdirSync(workDir, { recursive: true });
  writeFileSync(join(workDir, "status.json"), JSON.stringify({
    issue: {
      provider: "github",
      base_url: "https://github.com",
      repository: "aivv73/slopflow",
      kind: "issue",
      id: "999",
    },
  }), "utf8");

  const result = slopflow(repo, env, "start", "2");

  assert.equal(result.status, 2);
  assert.match(result.stdout, /status: blocked/);
  assert.match(result.stdout, /different issue reference/);
}));

test("start reports gh authentication failures with command diagnostics", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);

  const result = slopflow(repo, env, "start", "4");

  assert.equal(result.status, 2);
  assert.match(result.stdout, /error:/);
  assert.match(result.stdout, /status: blocked/);
  assert.match(result.stdout, /GitHub command failed while reading issue work/);
  assert.match(result.stdout, /command: gh issue view 4 --repo aivv73\/slopflow --json number,title,body,url,state/);
  assert.match(result.stdout, /exit-code: 4/);
  assert.match(result.stdout, /authentication required/);
  assert.match(result.stdout, /next-step: gh auth login/);
  assert.equal(result.stderr, "");
}));

test("start reports malformed gh JSON with parse diagnostics", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);

  const result = slopflow(repo, env, "start", "3");

  assert.equal(result.status, 2);
  assert.match(result.stdout, /GitHub command failed while reading issue work/);
  assert.match(result.stdout, /command: gh issue view 3 --repo aivv73\/slopflow --json number,title,body,url,state/);
  assert.match(result.stdout, /exit-code: 0/);
  assert.match(result.stdout, /Unexpected token|Expected property name|JSON/);
  assert.match(result.stdout, /next-step: inspect gh JSON output or update GitHub response parsing/);
}));

test("start reports issue and PR not found separately from tool failures", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);

  const result = slopflow(repo, env, "start", "999");

  assert.equal(result.status, 2);
  assert.match(result.stdout, /Could not read GitHub issue or PR 999/);
  assert.match(result.stdout, /command: gh issue view 999 .* && gh pr view 999/);
  assert.match(result.stdout, /exit-code: 1/);
  assert.match(result.stdout, /detail: not found/);
  assert.match(result.stdout, /next-step: verify 999 exists in aivv73\/slopflow/);
}));

test("start reports missing gh executable with spawn diagnostics", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  const withoutGh = { ...env, PATH: mkdtempSync(join(tmpdir(), "slopflow-no-gh-")) };

  const result = slopflow(repo, withoutGh, "start", "2");

  assert.equal(result.status, 2);
  assert.match(result.stdout, /GitHub command failed while reading issue work/);
  assert.match(result.stdout, /command: gh issue view 2 --repo aivv73\/slopflow --json number,title,body,url,state/);
  assert.match(result.stdout, /exit-code: spawn-error/);
  assert.match(result.stdout, /detail: .*ENOENT|spawn gh ENOENT/);
  assert.match(result.stdout, /next-step: install GitHub CLI `gh` and ensure it is on PATH/);
}));

test("test records passed command evidence", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);

  const result = slopflow(repo, env, "test", "2", "--name", "unit", "--", process.execPath, "-e", "console.log('pass'); console.error('note')");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /test:/);
  assert.match(result.stdout, /status: passed/);
  assert.match(result.stdout, /issue: github:aivv73\/slopflow issue 2/);
  assert.match(result.stdout, /gate: unit/);
  assert.match(result.stdout, /exit-code: 0/);
  assert.match(result.stdout, /evidence: \.slopflow\/work\/github-aivv73-slopflow-issue-2-7335e961\/evidence\/tests.json/);

  const evidence = JSON.parse(readFileSync(join(workDirFor(repo, "2"), "evidence", "tests.json"), "utf8"));
  assert.equal(evidence.schema_version, 1);
  assert.equal(evidence.attempts.length, 1);
  assert.equal(evidence.attempts[0].name, "unit");
  assert.equal(evidence.attempts[0].status, "passed");
  assert.deepEqual(evidence.latest.unit, {
    attempt_id: evidence.attempts[0].attempt_id,
    status: "passed",
    exit_code: 0,
    log: evidence.attempts[0].log,
  });
  assert.match(evidence.attempts[0].attempt_id, /^unit-\d{4}-\d{2}-\d{2}T/);

  const log = readFileSync(join(workDirFor(repo, "2"), evidence.attempts[0].log), "utf8");
  assert.match(log, /slopflow test log/);
  assert.match(log, /gate: unit/);
  assert.match(log, /exit_code: 0/);
  assert.match(log, /--- stdout ---\npass/);
  assert.match(log, /--- stderr ---\nnote/);
}));

test("test records failed command evidence and returns wrapped exit code", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);

  const result = slopflow(repo, env, "test", "2", "--name", "unit", "--", process.execPath, "-e", "console.error('boom'); process.exit(7)");

  assert.equal(result.status, 7);
  assert.match(result.stdout, /status: failed/);
  assert.match(result.stdout, /exit-code: 7/);
  assert.match(result.stdout, /next-step: fix implementation or create reviewed test exception/);

  const evidence = JSON.parse(readFileSync(join(workDirFor(repo, "2"), "evidence", "tests.json"), "utf8"));
  assert.equal(evidence.attempts.length, 1);
  assert.equal(evidence.latest.unit.status, "failed");
  assert.equal(evidence.latest.unit.exit_code, 7);
  const log = readFileSync(join(workDirFor(repo, "2"), evidence.latest.unit.log), "utf8");
  assert.match(log, /--- stderr ---\nboom/);
}));

test("test appends attempts and updates latest per gate", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  assert.equal(slopflow(repo, env, "test", "2", "--name", "unit", "--", process.execPath, "-e", "process.exit(5)").status, 5);
  assert.equal(slopflow(repo, env, "test", "2", "--name", "unit", "--", process.execPath, "-e", "console.log('fixed')").status, 0);

  const evidence = JSON.parse(readFileSync(join(workDirFor(repo, "2"), "evidence", "tests.json"), "utf8"));
  assert.equal(evidence.attempts.length, 2);
  assert.equal(evidence.attempts[0].status, "failed");
  assert.equal(evidence.attempts[1].status, "passed");
  assert.deepEqual(evidence.latest.unit, {
    attempt_id: evidence.attempts[1].attempt_id,
    status: "passed",
    exit_code: 0,
    log: evidence.attempts[1].log,
  });
  assert.notEqual(evidence.attempts[0].log, evidence.attempts[1].log);
}));

test("test records attempt-scoped evidence from attempt workspace without satisfying canonical gates", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  assert.equal(slopflow(repo, env, "attempt", "create", "2").status, 0);
  const attemptDir = join(workDirFor(repo, "2"), "attempts", "a1");
  const workspace = JSON.parse(readFileSync(join(attemptDir, "workspace.json"), "utf8"));

  const result = run([
    process.execPath,
    cliPath,
    "test",
    "2",
    "--attempt",
    "a1",
    "--name",
    "unit",
    "--",
    process.execPath,
    "-e",
    "require('node:fs').writeFileSync('attempt-cwd.txt', process.cwd())",
  ], workspace.path, false, env);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /status: passed/);
  assert.match(result.stdout, /evidence: .*attempts\/a1\/evidence\/tests\.json/);
  assert.match(result.stdout, /next-step: slopflow attempt submit 2 a1/);
  assert.equal(readFileSync(join(workspace.path, "attempt-cwd.txt"), "utf8"), workspace.path);
  assert.equal(existsSync(join(workDirFor(repo, "2"), "evidence", "tests.json")), false);

  const evidencePath = join(attemptDir, "evidence", "tests.json");
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  assert.equal(evidence.attempts.length, 1);
  assert.equal(evidence.latest.unit.status, "passed");
  const log = readFileSync(join(attemptDir, evidence.attempts[0].log), "utf8");
  assert.match(log, new RegExp(`cwd: ${escapeRegExp(workspace.path)}`));

  writeFileSync(join(attemptDir, "summary.md"), "Attempt summary from canonical artifacts.\n", "utf8");
  const submitted = run([process.execPath, cliPath, "attempt", "submit", "2", "a1"], workspace.path, false, env);
  assert.equal(submitted.status, 0, submitted.stderr);
  assert.match(submitted.stdout, /status: submitted/);
  const attempt = JSON.parse(readFileSync(join(attemptDir, "attempt.json"), "utf8"));
  assert.equal(attempt.status, "submitted");
  assert.equal(existsSync(join(workspace.path, ".slopflow", "work")), false);

  writeReview(repo, "2");
  const complete = slopflow(repo, env, "complete", "2");
  assert.equal(complete.status, 2);
  assert.match(complete.stdout, /reason: missing test evidence/);
}));

test("attempt compare writes bounded comparison for submitted attempts without reviewer verdict", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  assert.equal(slopflow(repo, env, "attempt", "create", "2", "--count", "2").status, 0);
  const attemptsRoot = join(workDirFor(repo, "2"), "attempts");
  const a1Workspace = JSON.parse(readFileSync(join(attemptsRoot, "a1", "workspace.json"), "utf8"));
  writeFileSync(join(attemptsRoot, "a1", "summary.md"), "Attempt one changes.\n", "utf8");
  writeFileSync(join(a1Workspace.path, "attempt-one.txt"), "hello\n", "utf8");
  assert.equal(run([process.execPath, cliPath, "test", "2", "--attempt", "a1", "--name", "unit", "--", process.execPath, "-e", "process.exit(0)"], a1Workspace.path, false, env).status, 0);
  assert.equal(slopflow(repo, env, "attempt", "submit", "2", "a1").status, 0);

  writeFileSync(join(attemptsRoot, "a2", "summary.md"), "Attempt two has missing evidence and workspace metadata.\n", "utf8");
  rmSync(join(attemptsRoot, "a2", "workspace.json"), { force: true });
  assert.equal(slopflow(repo, env, "attempt", "submit", "2", "a2").status, 0);

  const compared = slopflow(repo, env, "attempt", "compare", "2");
  assert.equal(compared.status, 0, compared.stderr);
  assert.match(compared.stdout, /attempt-comparison:/);
  assert.match(compared.stdout, /status: created/);
  assert.match(compared.stdout, /attempts: 2/);
  assert.match(compared.stdout, /comparison: \.slopflow\/work\/github-aivv73-slopflow-issue-2-7335e961\/attempt-comparison\.md/);
  assert.equal(existsSync(join(workDirFor(repo, "2"), "review.json")), false);

  const comparison = readFileSync(join(workDirFor(repo, "2"), "attempt-comparison.md"), "utf8");
  assert.match(comparison, /This artifact is a comparison aid only/);
  assert.match(comparison, /## a1/);
  assert.match(comparison, /Attempt one changes/);
  assert.match(comparison, /Status: present/);
  assert.match(comparison, /attempt-one\.txt/);
  assert.match(comparison, /## a2/);
  assert.match(comparison, /Attempt two has missing evidence/);
  assert.match(comparison, /Status: missing/);
  assert.match(comparison, /_Missing workspace\.json_/);
}));

test("attempt select records auditable decision and handles invalid selections", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  assert.equal(slopflow(repo, env, "attempt", "create", "2", "--count", "3").status, 0);
  const attemptsRoot = join(workDirFor(repo, "2"), "attempts");

  const missingReason = slopflow(repo, env, "attempt", "select", "2", "a1");
  assert.equal(missingReason.status, 2);
  assert.match(missingReason.stdout, /Missing required `--reason <text>`/);

  const notSubmitted = slopflow(repo, env, "attempt", "select", "2", "a1", "--reason", "looks good");
  assert.equal(notSubmitted.status, 2);
  assert.match(notSubmitted.stdout, /Only submitted attempts can be selected/);

  for (const id of ["a1", "a2", "a3"]) {
    writeFileSync(join(attemptsRoot, id, "summary.md"), `${id} summary\n`, "utf8");
    assert.equal(slopflow(repo, env, "attempt", "submit", "2", id).status, 0);
  }

  const selected = slopflow(repo, env, "attempt", "select", "2", "a2", "--reason", "best evidence");
  assert.equal(selected.status, 0, selected.stderr);
  assert.match(selected.stdout, /attempt-selection:/);
  assert.match(selected.stdout, /status: selected/);
  assert.equal(existsSync(join(workDirFor(repo, "2"), "review.json")), false);
  assert.equal(existsSync(join(workDirFor(repo, "2"), "completion-note.md")), false);

  const selection = JSON.parse(readFileSync(join(workDirFor(repo, "2"), "selection.json"), "utf8"));
  assert.equal(selection.selected_attempt_id, "a2");
  assert.equal(selection.reason, "best evidence");
  assert.match(selection.selected_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof selection.selected_by, "string");
  assert.equal(JSON.parse(readFileSync(join(attemptsRoot, "a2", "attempt.json"), "utf8")).status, "selected");
  assert.equal(JSON.parse(readFileSync(join(attemptsRoot, "a1", "attempt.json"), "utf8")).status, "rejected");
  assert.equal(JSON.parse(readFileSync(join(attemptsRoot, "a3", "attempt.json"), "utf8")).status, "rejected");

  const conflict = slopflow(repo, env, "attempt", "select", "2", "a1", "--reason", "changed mind");
  assert.equal(conflict.status, 2);
  assert.match(conflict.stdout, /Selected attempt already exists/);
  const forcedSameSelection = slopflow(repo, env, "attempt", "select", "2", "a2", "--reason", "confirmed", "--force");
  assert.equal(forcedSameSelection.status, 0, forcedSameSelection.stderr);
  assert.equal(JSON.parse(readFileSync(join(workDirFor(repo, "2"), "selection.json"), "utf8")).reason, "confirmed");
}));

test("attempt promote copies selected evidence and records artifact-only metadata", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  assert.equal(slopflow(repo, env, "attempt", "create", "2").status, 0);
  const workDir = workDirFor(repo, "2");
  const attemptDir = join(workDir, "attempts", "a1");
  const workspace = JSON.parse(readFileSync(join(attemptDir, "workspace.json"), "utf8"));

  const missingSelection = slopflow(repo, env, "attempt", "promote", "2");
  assert.equal(missingSelection.status, 2);
  assert.match(missingSelection.stdout, /Missing selected-attempt decision/);

  writeFileSync(join(workspace.path, "selected-code.txt"), "selected\n", "utf8");
  assert.equal(run([process.execPath, cliPath, "test", "2", "--attempt", "a1", "--name", "unit", "--", process.execPath, "-e", "process.exit(0)"], workspace.path, false, env).status, 0);
  writeFileSync(join(attemptDir, "summary.md"), "Selected attempt.\n", "utf8");
  assert.equal(slopflow(repo, env, "attempt", "submit", "2", "a1").status, 0);
  assert.equal(slopflow(repo, env, "attempt", "select", "2", "a1", "--reason", "best").status, 0);

  const promoted = slopflow(repo, env, "attempt", "promote", "2");
  assert.equal(promoted.status, 0, promoted.stderr);
  assert.match(promoted.stdout, /attempt-promotion:/);
  assert.match(promoted.stdout, /status: promoted/);
  assert.match(promoted.stdout, /mode: artifact-only/);
  assert.match(promoted.stdout, /next-step: cd .*slopflow review 2/);

  const promotion = JSON.parse(readFileSync(join(workDir, "promotion.json"), "utf8"));
  assert.equal(promotion.promoted_from_attempt_id, "a1");
  assert.equal(promotion.execution_workspace_path, workspace.path);
  assert.equal(promotion.promotion_kind, "artifact-only");
  const status = JSON.parse(readFileSync(join(workDir, "status.json"), "utf8"));
  assert.equal(status.promoted_from_attempt_id, "a1");
  assert.equal(status.execution_workspace_path, workspace.path);
  assert.equal(existsSync(join(workDir, "evidence", "tests.json")), true);
  assert.equal(JSON.parse(readFileSync(join(workDir, "evidence", "tests.json"), "utf8")).latest.unit.status, "passed");
  assert.equal(existsSync(join(repo, "selected-code.txt")), false, "promotion must not move code into canonical checkout");
  assert.equal(existsSync(join(workDir, "review.json")), false);
  assert.equal(existsSync(join(workDir, "completion-note.md")), false);
}));

test("promoted review and complete require selected execution workspace", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  assert.equal(slopflow(repo, env, "attempt", "create", "2").status, 0);
  const workDir = workDirFor(repo, "2");
  const attemptDir = join(workDir, "attempts", "a1");
  const workspace = JSON.parse(readFileSync(join(attemptDir, "workspace.json"), "utf8"));
  assert.equal(run([process.execPath, cliPath, "test", "2", "--attempt", "a1", "--name", "unit", "--", process.execPath, "-e", "process.exit(0)"], workspace.path, false, env).status, 0);
  writeFileSync(join(attemptDir, "summary.md"), "Selected attempt.\n", "utf8");
  assert.equal(slopflow(repo, env, "attempt", "submit", "2", "a1").status, 0);
  assert.equal(slopflow(repo, env, "attempt", "select", "2", "a1", "--reason", "best").status, 0);
  assert.equal(slopflow(repo, env, "attempt", "promote", "2").status, 0);

  const blockedReview = slopflow(repo, env, "review", "2");
  assert.equal(blockedReview.status, 2);
  assert.match(blockedReview.stdout, /status: blocked/);
  assert.match(blockedReview.stdout, /execution-workspace:/);
  assert.match(blockedReview.stdout, /cd .*slopflow review 2/);

  const workspaceReview = run([process.execPath, cliPath, "review", "2"], workspace.path, false, env);
  assert.equal(workspaceReview.status, 0, workspaceReview.stderr);
  assert.match(workspaceReview.stdout, /status: pending/);

  writeReview(repo, "2");
  const blockedComplete = slopflow(repo, env, "complete", "2");
  assert.equal(blockedComplete.status, 2);
  assert.match(blockedComplete.stdout, /promoted issue work must be completed/);
  assert.match(blockedComplete.stdout, /cd .*slopflow complete 2/);

  const workspaceComplete = run([process.execPath, cliPath, "complete", "2"], workspace.path, false, env);
  assert.equal(workspaceComplete.status, 0, workspaceComplete.stderr);
  assert.match(workspaceComplete.stdout, /status: complete/);
}));

test("test refuses missing work directory", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);

  const result = slopflow(repo, env, "test", "2", "--name", "unit", "--", process.execPath, "-e", "console.log('never')");

  assert.equal(result.status, 2);
  assert.match(result.stdout, /status: blocked/);
  assert.match(result.stdout, /slopflow start 2/);
}));

test("test validates gate name and command separator", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);

  const invalidName = slopflow(repo, env, "test", "2", "--name", "Unit", "--", process.execPath, "-e", "console.log('never')");
  assert.equal(invalidName.status, 2);
  assert.match(invalidName.stdout, /Invalid gate name/);

  const missingSeparator = slopflow(repo, env, "test", "2", "--name", "unit", process.execPath, "-e", "console.log('never')");
  assert.equal(missingSeparator.status, 2);
  assert.match(missingSeparator.stdout, /Missing `--`/);
}));

test("pause writes note and resume reactivates paused work", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);

  const paused = slopflow(repo, env, "pause", "2", "--reason", "waiting for review availability");
  assert.equal(paused.status, 0, paused.stderr);
  assert.match(paused.stdout, /pause:/);
  assert.match(paused.stdout, /status: paused/);
  assert.match(paused.stdout, /pause-note: \.slopflow\/work\/github-aivv73-slopflow-issue-2-7335e961\/pause-note.md/);
  assert.match(paused.stdout, /next-step: slopflow resume 2/);

  const workDir = workDirFor(repo, "2");
  const pauseNote = readFileSync(join(workDir, "pause-note.md"), "utf8");
  assert.match(pauseNote, /# Pause Note/);
  assert.match(pauseNote, /waiting for review availability/);
  assert.equal(existsSync(join(workDir, "contract.md")), true);
  assert.equal(JSON.parse(readFileSync(join(workDir, "status.json"), "utf8")).status, "paused");

  const resumed = slopflow(repo, env, "resume", "2");
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.match(resumed.stdout, /resume:/);
  assert.match(resumed.stdout, /status: active/);
  assert.match(resumed.stdout, /contract: \.slopflow\/work\/github-aivv73-slopflow-issue-2-7335e961\/contract.md/);
  assert.match(resumed.stdout, /tests: missing/);
  assert.match(resumed.stdout, /review: missing/);
  assert.match(resumed.stdout, /next-step: slopflow test 2 --name <gate> -- <command>/);
  assert.equal(JSON.parse(readFileSync(join(workDir, "status.json"), "utf8")).status, "active");
}));

test("cancel writes note, preserves artifacts, and blocks resume", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);

  const cancelled = slopflow(repo, env, "cancel", "2", "--reason", "superseded by another issue");
  assert.equal(cancelled.status, 0, cancelled.stderr);
  assert.match(cancelled.stdout, /cancel:/);
  assert.match(cancelled.stdout, /status: cancelled/);
  assert.match(cancelled.stdout, /cancel-note: \.slopflow\/work\/github-aivv73-slopflow-issue-2-7335e961\/cancel-note.md/);
  assert.match(cancelled.stdout, /artifacts: preserved/);

  const workDir = workDirFor(repo, "2");
  assert.equal(existsSync(join(workDir, "contract.md")), true);
  assert.match(readFileSync(join(workDir, "cancel-note.md"), "utf8"), /superseded by another issue/);
  assert.equal(JSON.parse(readFileSync(join(workDir, "status.json"), "utf8")).status, "cancelled");

  const resumed = slopflow(repo, env, "resume", "2");
  assert.equal(resumed.status, 2);
  assert.match(resumed.stdout, /Cancelled issue work cannot be resumed/);
}));

test("lifecycle commands validate reasons and terminal transitions", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);

  const missingReason = slopflow(repo, env, "pause", "2");
  assert.equal(missingReason.status, 2);
  assert.match(missingReason.stdout, /Missing required `--reason <text>`/);

  assert.equal(slopflow(repo, env, "cancel", "2", "--reason", "not needed").status, 0);
  const pauseCancelled = slopflow(repo, env, "pause", "2", "--reason", "later");
  assert.equal(pauseCancelled.status, 2);
  assert.match(pauseCancelled.stdout, /Cancelled issue work cannot be paused/);

  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  const invalidId = slopflow(repo, env, "resume", "abc");
  assert.equal(invalidId.status, 2);
  assert.match(invalidId.stdout, /Issue work status not found|unsafe characters/);
}));

test("status reports active paused cancelled and complete work counts", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  for (const [id, status] of [["1", "active"], ["2", "paused"], ["3", "cancelled"], ["4", "complete"]]) {
    const workDir = join(repo, ".slopflow", "work", id);
    mkdirSync(workDir, { recursive: true });
    writeFileSync(join(workDir, "status.json"), JSON.stringify({
      schema_version: 1,
      status,
      issue: { provider: "github", repo: "aivv73/slopflow", number: Number(id), kind: "issue" },
    }), "utf8");
  }

  const result = slopflow(repo, env, "status");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /active-work-count: 1/);
  assert.match(result.stdout, /paused-work-count: 1/);
  assert.match(result.stdout, /cancelled-work-count: 1/);
  assert.match(result.stdout, /complete-work-count: 1/);
}));

test("review creates packet and reports pending when review verdict is missing", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  writeFileSync(join(repo, "changed.txt"), "review me\n", "utf8");

  const result = slopflow(repo, env, "review", "2");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /review:/);
  assert.match(result.stdout, /status: pending/);
  assert.match(result.stdout, /verdict: missing/);
  assert.match(result.stdout, /test-evidence: missing/);
  assert.match(result.stdout, /next-step: ask reviewer to write review.json/);
  assert.equal(existsSync(join(workDirFor(repo, "2"), "review.json")), false);

  const packet = readFileSync(join(workDirFor(repo, "2"), "review-packet.md"), "utf8");
  assert.match(packet, /# Review Packet/);
  assert.match(packet, /Issue: github:aivv73\/slopflow issue 2/);
  assert.match(packet, /## Contract/);
  assert.match(packet, /## Test Evidence Summary/);
  assert.match(packet, /Status: missing/);
  assert.match(packet, /## Jujutsu Status/);
  assert.match(packet, /## Changed Files/);
  assert.match(packet, /changed.txt/);
  assert.match(packet, /## Diff Excerpt/);
  assert.match(packet, /Inline diff limit: 50000 characters/);
  assert.match(packet, /Valid `review.json` schema/);
}));

test("review packet marks truncated diff excerpt", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  writeFileSync(join(repo, "large-change.txt"), `${"x".repeat(60_000)}\n`, "utf8");

  const result = slopflow(repo, env, "review", "2");

  assert.equal(result.status, 0, result.stderr);
  const packet = readFileSync(join(workDirFor(repo, "2"), "review-packet.md"), "utf8");
  assert.match(packet, /Diff excerpt truncated/);
  assert.match(packet, /Inline diff limit: 50000 characters/);
}));

test("review reports complete verdict", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  assert.equal(slopflow(repo, env, "test", "2", "--name", "unit", "--", process.execPath, "-e", "console.log('ok')").status, 0);
  writeFileSync(join(workDirFor(repo, "2"), "review.json"), JSON.stringify({
    schema_version: 1,
    verdict: "complete",
    reviewer: "pi-reviewer",
    reviewed_at: new Date().toISOString(),
    summary: "Looks good.",
    required_changes: [],
  }), "utf8");

  const result = slopflow(repo, env, "review", "2");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /status: complete/);
  assert.match(result.stdout, /verdict: complete/);
  assert.match(result.stdout, /test-evidence: present/);
  assert.match(result.stdout, /next-step: slopflow complete 2/);
}));

test("review reports changes-requested verdict", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  writeFileSync(join(workDirFor(repo, "2"), "review.json"), JSON.stringify({
    schema_version: 1,
    verdict: "changes-requested",
    reviewer: "pi-reviewer",
    reviewed_at: new Date().toISOString(),
    summary: "Needs work.",
    required_changes: ["Add test evidence."],
  }), "utf8");

  const result = slopflow(repo, env, "review", "2");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /status: changes-requested/);
  assert.match(result.stdout, /verdict: changes-requested/);
  assert.match(result.stdout, /next-step: address required changes/);
}));

test("review blocks invalid review verdict after updating packet", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  writeFileSync(join(workDirFor(repo, "2"), "review.json"), JSON.stringify({
    schema_version: 1,
    verdict: "complete",
    reviewer: "pi-reviewer",
    reviewed_at: new Date().toISOString(),
    summary: "Contradictory.",
    required_changes: ["Still needs work."],
  }), "utf8");

  const result = slopflow(repo, env, "review", "2");

  assert.equal(result.status, 2);
  assert.match(result.stdout, /status: blocked/);
  assert.match(result.stdout, /verdict: invalid/);
  assert.match(result.stdout, /fix review.json/);
  assert.equal(existsSync(join(workDirFor(repo, "2"), "review-packet.md")), true);
}));

test("review blocks malformed review json with review output", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  writeFileSync(join(workDirFor(repo, "2"), "review.json"), "{ not json", "utf8");

  const result = slopflow(repo, env, "review", "2");

  assert.equal(result.status, 2);
  assert.match(result.stdout, /review:/);
  assert.match(result.stdout, /status: blocked/);
  assert.match(result.stdout, /verdict: invalid/);
  assert.match(result.stdout, /packet: \.slopflow\/work\/github-aivv73-slopflow-issue-2-7335e961\/review-packet.md/);
  assert.equal(result.stderr, "");
  assert.equal(existsSync(join(workDirFor(repo, "2"), "review-packet.md")), true);
}));

test("review refuses missing work directory and non-numeric issue id", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);

  const missingWork = slopflow(repo, env, "review", "2");
  assert.equal(missingWork.status, 2);
  assert.match(missingWork.stdout, /status: blocked/);
  assert.match(missingWork.stdout, /slopflow start 2/);

  const invalidId = slopflow(repo, env, "review", "abc");
  assert.equal(invalidId.status, 2);
  assert.match(invalidId.stdout, /Issue work status not found|unsafe characters/);
}));

test("complete marks work complete and generates completion note", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  assert.equal(slopflow(repo, env, "test", "2", "--name", "unit", "--", process.execPath, "-e", "console.log('ok')").status, 0);
  writeReview(repo, "2");

  const result = slopflow(repo, env, "complete", "2");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /complete:/);
  assert.match(result.stdout, /status: complete/);
  assert.match(result.stdout, /issue: github:aivv73\/slopflow issue 2/);
  assert.match(result.stdout, /tests: passed/);
  assert.match(result.stdout, /review: complete/);
  assert.match(result.stdout, /completion-note: \.slopflow\/work\/github-aivv73-slopflow-issue-2-7335e961\/completion-note.md/);

  const status = JSON.parse(readFileSync(join(workDirFor(repo, "2"), "status.json"), "utf8"));
  assert.equal(status.status, "complete");
  assert.match(status.completed_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(status.issue, {
    provider: "github",
    base_url: "https://github.com",
    repository: "aivv73/slopflow",
    kind: "issue",
    id: "2",
    url: "https://github.com/aivv73/slopflow/issues/2",
    repo: "aivv73/slopflow",
    number: 2,
  });

  const note = readFileSync(join(workDirFor(repo, "2"), "completion-note.md"), "utf8");
  assert.match(note, /# Completion Note/);
  assert.match(note, /Issue: github:aivv73\/slopflow issue 2/);
  assert.match(note, /Tests: passed/);
  assert.match(note, /Verdict: complete/);
}));

test("complete preserves existing completion note", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  assert.equal(slopflow(repo, env, "test", "2", "--name", "unit", "--", process.execPath, "-e", "console.log('ok')").status, 0);
  writeReview(repo, "2");
  const notePath = join(workDirFor(repo, "2"), "completion-note.md");
  writeFileSync(notePath, "human note\n", "utf8");

  assert.equal(slopflow(repo, env, "complete", "2").status, 0);

  assert.equal(readFileSync(notePath, "utf8"), "human note\n");
}));

test("complete blocks missing and failed test evidence", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  writeReview(repo, "2");

  const missing = slopflow(repo, env, "complete", "2");
  assert.equal(missing.status, 2);
  assert.match(missing.stdout, /status: blocked/);
  assert.match(missing.stdout, /reason: missing test evidence/);

  assert.equal(slopflow(repo, env, "test", "2", "--name", "unit", "--", process.execPath, "-e", "process.exit(6)").status, 6);
  const failed = slopflow(repo, env, "complete", "2");
  assert.equal(failed.status, 2);
  assert.match(failed.stdout, /failed latest test gate: unit/);
}));

test("complete blocks cancelled work", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  assert.equal(slopflow(repo, env, "test", "2", "--name", "unit", "--", process.execPath, "-e", "console.log('ok')").status, 0);
  writeReview(repo, "2");
  assert.equal(slopflow(repo, env, "cancel", "2", "--reason", "superseded").status, 0);

  const result = slopflow(repo, env, "complete", "2");

  assert.equal(result.status, 2);
  assert.match(result.stdout, /status: blocked/);
  assert.match(result.stdout, /reason: issue work is cancelled/);
}));

test("complete requires at least one passed latest test gate", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  mkdirSync(join(workDirFor(repo, "2"), "evidence"), { recursive: true });
  writeFileSync(join(workDirFor(repo, "2"), "evidence", "tests.json"), JSON.stringify({
    schema_version: 1,
    attempts: [],
    latest: {
      unit: {
        attempt_id: "unit-2026-01-01T00-00-00-000Z",
        status: "skipped",
        exit_code: 0,
        log: "evidence/logs/unit-2026-01-01T00-00-00-000Z.txt",
      },
    },
  }), "utf8");
  writeReview(repo, "2");

  const result = slopflow(repo, env, "complete", "2");

  assert.equal(result.status, 2);
  assert.match(result.stdout, /reason: no latest test gate passed/);
}));

test("complete blocks missing, changes-requested, and invalid review", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  assert.equal(slopflow(repo, env, "test", "2", "--name", "unit", "--", process.execPath, "-e", "console.log('ok')").status, 0);

  const missing = slopflow(repo, env, "complete", "2");
  assert.equal(missing.status, 2);
  assert.match(missing.stdout, /reason: missing review verdict/);

  writeReview(repo, "2", { verdict: "changes-requested", required_changes: ["Fix it."] });
  const changes = slopflow(repo, env, "complete", "2");
  assert.equal(changes.status, 2);
  assert.match(changes.stdout, /reason: review verdict is changes-requested/);

  writeReview(repo, "2", { verdict: "complete", required_changes: ["Contradiction."] });
  const invalid = slopflow(repo, env, "complete", "2");
  assert.equal(invalid.status, 2);
  assert.match(invalid.stdout, /reason: invalid review verdict/);
}));

test("complete allows reviewed test exception without tests", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  mkdirSync(join(workDirFor(repo, "2"), "evidence"), { recursive: true });
  writeFileSync(join(workDirFor(repo, "2"), "evidence", "test-exception.md"), "Tests cannot run in this sandbox.\n", "utf8");
  writeReview(repo, "2");

  const result = slopflow(repo, env, "complete", "2");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /tests: exception-accepted/);
  const note = readFileSync(join(workDirFor(repo, "2"), "completion-note.md"), "utf8");
  assert.match(note, /Test exception accepted by reviewer/);
}));

test("complete validates issue id, work directory, and contract", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  const invalidId = slopflow(repo, env, "complete", "abc");
  assert.equal(invalidId.status, 2);
  assert.match(invalidId.stdout, /Issue work status not found|unsafe characters/);

  const missingWork = slopflow(repo, env, "complete", "2");
  assert.equal(missingWork.status, 2);
  assert.match(missingWork.stdout, /slopflow start 2/);

  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  rmSync(join(workDirFor(repo, "2"), "contract.md"));
  const missingContract = slopflow(repo, env, "complete", "2");
  assert.equal(missingContract.status, 2);
  assert.match(missingContract.stdout, /reason: missing contract.md/);
}));

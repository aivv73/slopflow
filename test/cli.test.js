import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function writeReview(repo, issueId, overrides = {}) {
  writeFileSync(join(repo, ".slopflow", "work", issueId, "review.json"), JSON.stringify({
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
    issue_tracker: {
      type: "github",
      repo: "aivv73/slopflow",
      prs_as_request_surface: true,
    },
    vcs: { type: "jj" },
  });
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

test("install minimal dry-run prints plan without writing", requiresJj, withRepo((repo, env) => {
  const result = slopflow(repo, env, "install", "minimal");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /install:/);
  assert.match(result.stdout, /status: planned/);
  assert.match(result.stdout, /profile: minimal/);
  assert.match(result.stdout, /mode: dry-run/);
  assert.match(result.stdout, /config-action: create/);
  assert.match(result.stdout, /work-root-action: create/);
  assert.match(result.stdout, /writes: none/);
  assert.match(result.stdout, /next-step: slopflow install minimal --yes/);
  assert.equal(existsSync(join(repo, ".slopflow", "config.json")), false);
  assert.equal(existsSync(join(repo, ".slopflow", "work")), false);
}));

test("install minimal --yes applies project-local setup", requiresJj, withRepo((repo, env) => {
  const result = slopflow(repo, env, "install", "minimal", "--yes");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /status: applied/);
  assert.match(result.stdout, /mode: apply/);
  assert.match(result.stdout, /writes: project-local/);
  assert.match(result.stdout, /next-step: slopflow doctor/);
  assert.equal(existsSync(join(repo, ".slopflow", "config.json")), true);
  assert.equal(existsSync(join(repo, ".slopflow", "work")), true);
}));

test("install minimal --yes is idempotent for compatible setup", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "install", "minimal", "--yes").status, 0);

  const second = slopflow(repo, env, "install", "minimal", "--yes");

  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /status: unchanged/);
  assert.match(second.stdout, /config-action: preserve/);
  assert.match(second.stdout, /work-root-action: preserve/);
}));

test("install minimal blocks incompatible existing config unless forced", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "install", "minimal", "--yes").status, 0);
  const configPath = join(repo, ".slopflow", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.artifact_root = ".elsewhere/work";
  writeFileSync(configPath, JSON.stringify(config), "utf8");

  const blocked = slopflow(repo, env, "install", "minimal", "--yes");
  assert.equal(blocked.status, 2);
  assert.match(blocked.stdout, /status: blocked/);
  assert.match(blocked.stdout, /differs from detected config/);
  assert.match(blocked.stdout, /slopflow install minimal --yes --force/);

  const forced = slopflow(repo, env, "install", "minimal", "--yes", "--force");
  assert.equal(forced.status, 0, forced.stdout);
  assert.match(forced.stdout, /config-action: refresh/);
  assert.equal(JSON.parse(readFileSync(configPath, "utf8")).artifact_root, ".slopflow/work");
}));

test("install recommended dry-run prints concrete project-local plan", requiresJj, withRepo((repo, env) => {
  const result = slopflow(repo, env, "install", "recommended");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /install:/);
  assert.match(result.stdout, /status: planned/);
  assert.match(result.stdout, /profile: recommended/);
  assert.match(result.stdout, /mode: dry-run/);
  assert.match(result.stdout, /manifest: \.pi\/slopflow-packages\.json/);
  assert.match(result.stdout, /manifest-action: create/);
  assert.match(result.stdout, /suggested-command: npx skills add aivv73\/slopflow --skill slopflow-live/);
  assert.match(result.stdout, /writes: none/);
  assert.equal(existsSync(join(repo, ".slopflow", "config.json")), false);
  assert.equal(existsSync(join(repo, ".pi", "slopflow-packages.json")), false);
}));

test("install recommended --yes writes only project-local setup and manifest", requiresJj, withRepo((repo, env) => {
  const result = slopflow(repo, env, "install", "recommended", "--yes");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /status: applied/);
  assert.match(result.stdout, /profile: recommended/);
  assert.match(result.stdout, /writes: project-local/);
  assert.equal(existsSync(join(repo, ".slopflow", "config.json")), true);
  assert.equal(existsSync(join(repo, ".slopflow", "work")), true);
  const manifest = JSON.parse(readFileSync(join(repo, ".pi", "slopflow-packages.json"), "utf8"));
  assert.equal(manifest.profile, "recommended");
  assert.equal(manifest.project_local_only, true);
  assert.deepEqual(manifest.suggested_commands, [
    "npx skills add aivv73/slopflow --skill setup-slopflow-skills-live",
    "npx skills add aivv73/slopflow --skill slopflow-live",
    "npx skills add aivv73/slopflow --skill slopflow",
  ]);
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
  assert.match(result.stdout, /next-step: install gh or continue if GitHub start is not needed/);
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
  assert.match(result.stdout, /issue: github:aivv73\/slopflow#2/);
  assert.match(result.stdout, /work-directory: \.slopflow\/work\/2/);
  assert.match(result.stdout, /contract: \.slopflow\/work\/2\/contract.md/);
  assert.match(result.stdout, /goal-prompt: \.slopflow\/work\/2\/goal-prompt.md/);

  const workDir = join(repo, ".slopflow", "work", "2");
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
    repo: "aivv73/slopflow",
    number: 2,
    kind: "issue",
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

test("start refuses existing work directory without status metadata", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  mkdirSync(join(repo, ".slopflow", "work", "2"), { recursive: true });

  const result = slopflow(repo, env, "start", "2");

  assert.equal(result.status, 2);
  assert.match(result.stdout, /status: blocked/);
  assert.match(result.stdout, /already exists without status metadata/);
}));

test("start refuses existing work directory for a different issue reference", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  const workDir = join(repo, ".slopflow", "work", "2");
  mkdirSync(workDir, { recursive: true });
  writeFileSync(join(workDir, "status.json"), JSON.stringify({
    issue: {
      provider: "github",
      repo: "aivv73/slopflow",
      number: 999,
      kind: "issue",
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
  assert.match(result.stdout, /Could not read GitHub issue or PR #999/);
  assert.match(result.stdout, /command: gh issue view 999 .* && gh pr view 999/);
  assert.match(result.stdout, /exit-code: 1/);
  assert.match(result.stdout, /detail: not found/);
  assert.match(result.stdout, /next-step: verify #999 exists in aivv73\/slopflow/);
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
  assert.match(result.stdout, /issue: github:aivv73\/slopflow#2/);
  assert.match(result.stdout, /gate: unit/);
  assert.match(result.stdout, /exit-code: 0/);
  assert.match(result.stdout, /evidence: \.slopflow\/work\/2\/evidence\/tests.json/);

  const evidence = JSON.parse(readFileSync(join(repo, ".slopflow", "work", "2", "evidence", "tests.json"), "utf8"));
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

  const log = readFileSync(join(repo, ".slopflow", "work", "2", evidence.attempts[0].log), "utf8");
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

  const evidence = JSON.parse(readFileSync(join(repo, ".slopflow", "work", "2", "evidence", "tests.json"), "utf8"));
  assert.equal(evidence.attempts.length, 1);
  assert.equal(evidence.latest.unit.status, "failed");
  assert.equal(evidence.latest.unit.exit_code, 7);
  const log = readFileSync(join(repo, ".slopflow", "work", "2", evidence.latest.unit.log), "utf8");
  assert.match(log, /--- stderr ---\nboom/);
}));

test("test appends attempts and updates latest per gate", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  assert.equal(slopflow(repo, env, "test", "2", "--name", "unit", "--", process.execPath, "-e", "process.exit(5)").status, 5);
  assert.equal(slopflow(repo, env, "test", "2", "--name", "unit", "--", process.execPath, "-e", "console.log('fixed')").status, 0);

  const evidence = JSON.parse(readFileSync(join(repo, ".slopflow", "work", "2", "evidence", "tests.json"), "utf8"));
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
  assert.match(paused.stdout, /pause-note: \.slopflow\/work\/2\/pause-note.md/);
  assert.match(paused.stdout, /next-step: slopflow resume 2/);

  const workDir = join(repo, ".slopflow", "work", "2");
  const pauseNote = readFileSync(join(workDir, "pause-note.md"), "utf8");
  assert.match(pauseNote, /# Pause Note/);
  assert.match(pauseNote, /waiting for review availability/);
  assert.equal(existsSync(join(workDir, "contract.md")), true);
  assert.equal(JSON.parse(readFileSync(join(workDir, "status.json"), "utf8")).status, "paused");

  const resumed = slopflow(repo, env, "resume", "2");
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.match(resumed.stdout, /resume:/);
  assert.match(resumed.stdout, /status: active/);
  assert.match(resumed.stdout, /contract: \.slopflow\/work\/2\/contract.md/);
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
  assert.match(cancelled.stdout, /cancel-note: \.slopflow\/work\/2\/cancel-note.md/);
  assert.match(cancelled.stdout, /artifacts: preserved/);

  const workDir = join(repo, ".slopflow", "work", "2");
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
  assert.match(invalidId.stdout, /Issue id must be a plain number/);
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
  assert.equal(existsSync(join(repo, ".slopflow", "work", "2", "review.json")), false);

  const packet = readFileSync(join(repo, ".slopflow", "work", "2", "review-packet.md"), "utf8");
  assert.match(packet, /# Review Packet/);
  assert.match(packet, /Issue: github:aivv73\/slopflow#2/);
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
  const packet = readFileSync(join(repo, ".slopflow", "work", "2", "review-packet.md"), "utf8");
  assert.match(packet, /Diff excerpt truncated/);
  assert.match(packet, /Inline diff limit: 50000 characters/);
}));

test("review reports complete verdict", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  assert.equal(slopflow(repo, env, "test", "2", "--name", "unit", "--", process.execPath, "-e", "console.log('ok')").status, 0);
  writeFileSync(join(repo, ".slopflow", "work", "2", "review.json"), JSON.stringify({
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
  writeFileSync(join(repo, ".slopflow", "work", "2", "review.json"), JSON.stringify({
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
  writeFileSync(join(repo, ".slopflow", "work", "2", "review.json"), JSON.stringify({
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
  assert.equal(existsSync(join(repo, ".slopflow", "work", "2", "review-packet.md")), true);
}));

test("review blocks malformed review json with review output", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  writeFileSync(join(repo, ".slopflow", "work", "2", "review.json"), "{ not json", "utf8");

  const result = slopflow(repo, env, "review", "2");

  assert.equal(result.status, 2);
  assert.match(result.stdout, /review:/);
  assert.match(result.stdout, /status: blocked/);
  assert.match(result.stdout, /verdict: invalid/);
  assert.match(result.stdout, /packet: \.slopflow\/work\/2\/review-packet.md/);
  assert.equal(result.stderr, "");
  assert.equal(existsSync(join(repo, ".slopflow", "work", "2", "review-packet.md")), true);
}));

test("review refuses missing work directory and non-numeric issue id", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);

  const missingWork = slopflow(repo, env, "review", "2");
  assert.equal(missingWork.status, 2);
  assert.match(missingWork.stdout, /status: blocked/);
  assert.match(missingWork.stdout, /slopflow start 2/);

  const invalidId = slopflow(repo, env, "review", "abc");
  assert.equal(invalidId.status, 2);
  assert.match(invalidId.stdout, /Issue id must be a plain number/);
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
  assert.match(result.stdout, /issue: github:aivv73\/slopflow#2/);
  assert.match(result.stdout, /tests: passed/);
  assert.match(result.stdout, /review: complete/);
  assert.match(result.stdout, /completion-note: \.slopflow\/work\/2\/completion-note.md/);

  const status = JSON.parse(readFileSync(join(repo, ".slopflow", "work", "2", "status.json"), "utf8"));
  assert.equal(status.status, "complete");
  assert.match(status.completed_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(status.issue, {
    provider: "github",
    repo: "aivv73/slopflow",
    number: 2,
    kind: "issue",
  });

  const note = readFileSync(join(repo, ".slopflow", "work", "2", "completion-note.md"), "utf8");
  assert.match(note, /# Completion Note/);
  assert.match(note, /Issue: github:aivv73\/slopflow#2/);
  assert.match(note, /Tests: passed/);
  assert.match(note, /Verdict: complete/);
}));

test("complete preserves existing completion note", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  assert.equal(slopflow(repo, env, "test", "2", "--name", "unit", "--", process.execPath, "-e", "console.log('ok')").status, 0);
  writeReview(repo, "2");
  const notePath = join(repo, ".slopflow", "work", "2", "completion-note.md");
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
  mkdirSync(join(repo, ".slopflow", "work", "2", "evidence"), { recursive: true });
  writeFileSync(join(repo, ".slopflow", "work", "2", "evidence", "tests.json"), JSON.stringify({
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
  mkdirSync(join(repo, ".slopflow", "work", "2", "evidence"), { recursive: true });
  writeFileSync(join(repo, ".slopflow", "work", "2", "evidence", "test-exception.md"), "Tests cannot run in this sandbox.\n", "utf8");
  writeReview(repo, "2");

  const result = slopflow(repo, env, "complete", "2");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /tests: exception-accepted/);
  const note = readFileSync(join(repo, ".slopflow", "work", "2", "completion-note.md"), "utf8");
  assert.match(note, /Test exception accepted by reviewer/);
}));

test("complete validates issue id, work directory, and contract", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  const invalidId = slopflow(repo, env, "complete", "abc");
  assert.equal(invalidId.status, 2);
  assert.match(invalidId.stdout, /Issue id must be a plain number/);

  const missingWork = slopflow(repo, env, "complete", "2");
  assert.equal(missingWork.status, 2);
  assert.match(missingWork.stdout, /slopflow start 2/);

  assert.equal(slopflow(repo, env, "start", "2").status, 0);
  rmSync(join(repo, ".slopflow", "work", "2", "contract.md"));
  const missingContract = slopflow(repo, env, "complete", "2");
  assert.equal(missingContract.status, 2);
  assert.match(missingContract.stdout, /reason: missing contract.md/);
}));

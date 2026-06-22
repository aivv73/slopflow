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
  run(["jj", "git", "init", "--colocate"], repo, true);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const ghPath = join(bin, "gh");
  writeFileSync(
    ghPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
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
process.stderr.write("not found\\n");
process.exit(1);
`,
  );
  chmodSync(ghPath, 0o755);
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
  assert.match(blocked.stderr, /status: blocked/);
  assert.match(blocked.stderr, /differs from detected config/);
  assert.match(blocked.stderr, /slopflow init --force/);
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

test("status blocks before init", requiresJj, withRepo((repo, env) => {
  const result = slopflow(repo, env, "status");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /status: blocked/);
  assert.match(result.stderr, /Run `slopflow init` first/);
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
  assert.match(result.stderr, /status: blocked/);
  assert.match(result.stderr, /already exists without status metadata/);
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
  assert.match(result.stderr, /status: blocked/);
  assert.match(result.stderr, /different issue reference/);
}));

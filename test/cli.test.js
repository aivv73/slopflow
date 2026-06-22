import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  return { dir, repo };
}

function run(args, cwd, check = false) {
  const result = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  if (check && result.status !== 0) {
    throw new Error(`${args.join(" ")} failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
  return result;
}

function slopflow(repo, ...args) {
  return run([process.execPath, cliPath, ...args], repo);
}

function withRepo(fn) {
  return async () => {
    const { dir, repo } = makeRepo();
    try {
      await fn(repo);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test("init creates machine config and work root", requiresJj, withRepo((repo) => {
  const result = slopflow(repo, "init");

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

test("init is idempotent for matching config", requiresJj, withRepo((repo) => {
  assert.equal(slopflow(repo, "init").status, 0);
  const second = slopflow(repo, "init");
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /status: unchanged/);
}));

test("init refuses incompatible config without force", requiresJj, withRepo((repo) => {
  assert.equal(slopflow(repo, "init").status, 0);
  const configPath = join(repo, ".slopflow", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.artifact_root = ".elsewhere/work";
  writeFileSync(configPath, JSON.stringify(config), "utf8");

  const blocked = slopflow(repo, "init");
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /status: blocked/);
  assert.match(blocked.stderr, /differs from detected config/);
  assert.match(blocked.stderr, /slopflow init --force/);
}));

test("init force refreshes incompatible config", requiresJj, withRepo((repo) => {
  assert.equal(slopflow(repo, "init").status, 0);
  const configPath = join(repo, ".slopflow", "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.artifact_root = ".elsewhere/work";
  writeFileSync(configPath, JSON.stringify(config), "utf8");

  const forced = slopflow(repo, "init", "--force");
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(forced.stdout, /status: reinitialized/);
  assert.equal(JSON.parse(readFileSync(configPath, "utf8")).artifact_root, ".slopflow/work");
}));

test("init detects repo root from subdirectory", requiresJj, withRepo((repo) => {
  const subdir = join(repo, "nested", "path");
  mkdirSync(subdir, { recursive: true });

  const result = slopflow(subdir, "init");
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotThrow(() => readFileSync(join(repo, ".slopflow", "config.json")));
}));

test("status reports config, jj change, active work count, and next step", requiresJj, withRepo((repo) => {
  assert.equal(slopflow(repo, "init").status, 0);
  mkdirSync(join(repo, ".slopflow", "work", "1"), { recursive: true });

  const result = slopflow(repo, "status");
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

test("status blocks before init", requiresJj, withRepo((repo) => {
  const result = slopflow(repo, "status");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /status: blocked/);
  assert.match(result.stderr, /Run `slopflow init` first/);
}));

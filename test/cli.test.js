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
  assert.match(result.stderr, /status: blocked/);
  assert.match(result.stderr, /slopflow start 2/);
}));

test("test validates gate name and command separator", requiresJj, withRepo((repo, env) => {
  assert.equal(slopflow(repo, env, "init").status, 0);
  assert.equal(slopflow(repo, env, "start", "2").status, 0);

  const invalidName = slopflow(repo, env, "test", "2", "--name", "Unit", "--", process.execPath, "-e", "console.log('never')");
  assert.equal(invalidName.status, 2);
  assert.match(invalidName.stderr, /Invalid gate name/);

  const missingSeparator = slopflow(repo, env, "test", "2", "--name", "unit", process.execPath, "-e", "console.log('never')");
  assert.equal(missingSeparator.status, 2);
  assert.match(missingSeparator.stderr, /Missing `--`/);
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
  assert.match(missingWork.stderr, /status: blocked/);
  assert.match(missingWork.stderr, /slopflow start 2/);

  const invalidId = slopflow(repo, env, "review", "abc");
  assert.equal(invalidId.status, 2);
  assert.match(invalidId.stderr, /Issue id must be a plain number/);
}));

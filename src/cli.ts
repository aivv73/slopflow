#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 1;
const DEFAULT_ARTIFACT_ROOT = ".slopflow/work";
const DEFAULT_PRS_AS_REQUEST_SURFACE = true;
const REVIEW_DIFF_LIMIT = 50_000;

type MachineConfig = {
  schema_version: number;
  artifact_root: string;
  issue_tracker: {
    type: "github";
    repo: string;
    prs_as_request_surface: boolean;
  };
  vcs: {
    type: "jj";
  };
};

type IssueReference = {
  provider: "github";
  repo: string;
  number: number;
  kind: "issue" | "pull_request";
};

type GitHubItem = {
  number: number;
  title: string;
  body: string;
  url: string;
  state: string;
  kind: "issue" | "pull_request";
};

type TestAttempt = {
  attempt_id: string;
  name: string;
  command: string;
  status: "passed" | "failed";
  exit_code: number;
  log: string;
  started_at: string;
  finished_at: string;
};

type TestLatest = {
  attempt_id: string;
  status: TestAttempt["status"];
  exit_code: number;
  log: string;
};

type TestEvidence = {
  schema_version: 1;
  latest: Record<string, TestLatest>;
  attempts: TestAttempt[];
};

type ReviewVerdict = {
  schema_version: 1;
  verdict: "complete" | "changes-requested";
  reviewer: string;
  reviewed_at: string;
  summary: string;
  required_changes: string[];
};

type WorkLifecycleStatus = "started" | "active" | "paused" | "cancelled" | "complete";

type WorkStatus = {
  schema_version?: number;
  status?: WorkLifecycleStatus | string;
  issue: IssueReference;
  [key: string]: unknown;
};

class SlopflowError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
    readonly code = 1,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const [command, ...args] = argv;
    if (!command) {
      return await homeCommand();
    }
    if (command === "--help" || command === "-h") {
      printHelp();
      return 0;
    }
    if (command === "init") {
      return initCommand({ force: args.includes("--force") });
    }
    if (command === "status") {
      return await statusCommand();
    }
    if (command === "doctor") {
      return doctorCommand();
    }
    if (command === "start") {
      return startCommand(args[0]);
    }
    if (command === "test") {
      return testCommand(args);
    }
    if (command === "pause") {
      return lifecycleCommand("pause", args);
    }
    if (command === "resume") {
      return lifecycleCommand("resume", args);
    }
    if (command === "cancel") {
      return lifecycleCommand("cancel", args);
    }
    if (command === "review") {
      return reviewCommand(args[0]);
    }
    if (command === "complete") {
      return completeCommand(args[0]);
    }
    throw new SlopflowError(`Unknown command: ${command}`, "Run `slopflow --help`.", 2);
  } catch (error) {
    if (error instanceof SlopflowError) {
      printBlock(
        "error",
        {
          status: "blocked",
          message: error.message,
          ...error.details,
          ...(error.hint ? { hint: error.hint } : {}),
        },
      );
      return error.code;
    }
    throw error;
  }
}

type DoctorCheck = {
  name: string;
  status: "passed" | "warn" | "failed";
  detail: string;
};

function doctorCommand(): number {
  const checks: DoctorCheck[] = [];
  checks.push({ name: "core.slopflow", status: "passed", detail: "cli running" });

  const root = findRepoRoot(process.cwd());
  const nodeEngine = root ? readPackageNodeEngine(root) : null;
  const nodeSatisfies = nodeEngine ? nodeVersionSatisfies(process.versions.node, nodeEngine) : true;
  checks.push({
    name: "core.node",
    status: nodeSatisfies ? "passed" : "failed",
    detail: nodeEngine ? `node v${process.versions.node} satisfies ${nodeEngine}` : `node v${process.versions.node}; package.json engines.node not found`,
  });

  const jjPresent = commandExists("jj");
  checks.push({
    name: "core.jj",
    status: jjPresent ? "passed" : "failed",
    detail: jjPresent ? "jj executable found" : "jj executable missing",
  });

  checks.push({
    name: "core.repository",
    status: root ? "passed" : "failed",
    detail: root ? `root ${relativeToCwd(root)}` : "no .jj or .git repository root found",
  });

  const jjRepo = root ? existsSync(join(root, ".jj")) : false;
  checks.push({
    name: "core.jj-repo",
    status: jjRepo ? "passed" : "failed",
    detail: jjRepo ? ".jj present" : "Jujutsu repository not detected",
  });

  const configPath = root ? join(root, ".slopflow", "config.json") : "";
  const configExists = Boolean(root && existsSync(configPath));
  checks.push({
    name: "core.config",
    status: configExists ? "passed" : "failed",
    detail: configExists ? relativeToCwd(configPath) : ".slopflow/config.json missing",
  });

  let artifactRoot = DEFAULT_ARTIFACT_ROOT;
  if (root && configExists) {
    try {
      artifactRoot = readMachineConfig(root).artifact_root;
    } catch {
      artifactRoot = DEFAULT_ARTIFACT_ROOT;
    }
  }
  const workRoot = root ? join(root, artifactRoot) : "";
  const workRootExists = Boolean(root && existsSync(workRoot));
  checks.push({
    name: "core.work-root",
    status: workRootExists ? "passed" : "failed",
    detail: workRootExists ? relativeToCwd(workRoot) : `${artifactRoot} missing`,
  });

  for (const [name, path] of [
    ["project-docs.issue-tracker", "docs/agents/issue-tracker.md"],
    ["project-docs.triage-labels", "docs/agents/triage-labels.md"],
    ["project-docs.domain", "docs/agents/domain.md"],
    ["project-docs.context", "CONTEXT.md"],
    ["project-docs.adr", "docs/adr"],
  ] as const) {
    const present = Boolean(root && existsSync(join(root, path)));
    checks.push({ name, status: present ? "passed" : "warn", detail: present ? path : `${path} missing` });
  }

  const ghPresent = commandExists("gh");
  checks.push({
    name: "recommended.gh",
    status: ghPresent ? "passed" : "warn",
    detail: ghPresent ? "gh executable found" : "gh executable missing; GitHub issue start may fail",
  });
  checks.push({
    name: "recommended.gh-axi",
    status: "warn",
    detail: "unchecked; run npx -y gh-axi --help when GitHub AXI operations are needed",
  });

  const failedCount = checks.filter((check) => check.status === "failed").length;
  const warningCount = checks.filter((check) => check.status === "warn").length;
  const status = failedCount > 0 ? "failed" : warningCount > 0 ? "warn" : "passed";
  const coreStatus = checks.some((check) => check.name.startsWith("core.") && check.status === "failed") ? "failed" : "passed";
  const projectDocsStatus = groupStatus(checks, "project-docs.");
  const recommendedStatus = groupStatus(checks, "recommended.");

  printBlock("doctor", {
    status,
    core: coreStatus,
    "project-docs": projectDocsStatus,
    recommended: recommendedStatus,
    "failed-count": failedCount,
    "warning-count": warningCount,
    "next-step": nextStepForDoctor(status, checks),
  });
  printBlock(`checks[${checks.length}]`, Object.fromEntries(checks.map((check) => [check.name, `${check.status} ${check.detail}`])));
  return failedCount > 0 ? 2 : 0;
}

function groupStatus(checks: DoctorCheck[], prefix: string): "passed" | "warn" | "failed" {
  const group = checks.filter((check) => check.name.startsWith(prefix));
  if (group.some((check) => check.status === "failed")) return "failed";
  if (group.some((check) => check.status === "warn")) return "warn";
  return "passed";
}

function nextStepForDoctor(status: string, checks: DoctorCheck[]): string {
  if (status === "passed") return "slopflow start <issue-id>";
  const firstFailed = checks.find((check) => check.status === "failed");
  if (firstFailed?.name === "core.config") return "slopflow init";
  if (firstFailed?.name === "core.work-root") return "slopflow init";
  if (firstFailed?.name === "core.jj") return "install jj";
  if (firstFailed?.name === "core.repository" || firstFailed?.name === "core.jj-repo") return "run inside a Jujutsu repository";
  const firstWarn = checks.find((check) => check.status === "warn");
  if (firstWarn?.name === "recommended.gh") return "install gh or continue if GitHub start is not needed";
  if (firstWarn?.name === "recommended.gh-axi") return "run npx -y gh-axi --help when GitHub AXI operations are needed";
  return "inspect doctor checks";
}

function readPackageNodeEngine(root: string): string | null {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) return null;
  try {
    const packageJson = readJson(packagePath) as { engines?: { node?: unknown } };
    return typeof packageJson.engines?.node === "string" ? packageJson.engines.node : null;
  } catch {
    return null;
  }
}

function nodeVersionSatisfies(version: string, engine: string): boolean {
  const major = Number(version.split(".")[0] ?? "0");
  const minimumMajor = engine.match(/>=\s*(\d+)/)?.[1];
  if (minimumMajor) return major >= Number(minimumMajor);
  return true;
}

async function homeCommand(): Promise<number> {
  const bin = process.argv[1] ? relativeToCwd(realpathSync(process.argv[1])) : "slopflow";
  const description = "Controlled issue execution for AI coding agents.";
  const root = findRepoRoot(process.cwd());

  if (!root) {
    printBlock("slopflow", {
      bin,
      description,
      state: "no-repository",
      "next-step": "cd to a Slopflow repository or run `slopflow --help`",
    });
    return 0;
  }

  const configPath = join(root, ".slopflow", "config.json");
  if (!existsSync(configPath)) {
    printBlock("slopflow", {
      bin,
      description,
      state: "uninitialized",
      "repo-root": relativeToCwd(root),
      vcs: existsSync(join(root, ".jj")) ? "jj" : "unknown",
      "next-step": "slopflow init",
    });
    return 0;
  }

  const config = readMachineConfig(root);
  const artifactRoot = String(config.artifact_root ?? DEFAULT_ARTIFACT_ROOT);
  const workRoot = join(root, artifactRoot);
  const workCounts = await countWorkDirsByStatus(workRoot);

  printBlock("slopflow", {
    bin,
    description,
    state: "initialized",
    repo: config.issue_tracker.repo,
    issue_tracker: config.issue_tracker.type,
    vcs: config.vcs.type,
    "artifact-root": artifactRoot,
    "current-jj-change": readCurrentJjChange(root),
    "active-work-count": workCounts.active,
    "paused-work-count": workCounts.paused,
    "cancelled-work-count": workCounts.cancelled,
    "complete-work-count": workCounts.complete,
    "next-step": "slopflow start <issue-id>",
  });
  return 0;
}

function completeCommand(issueId: string | undefined): number {
  if (!issueId) {
    throw new SlopflowError("Missing issue id.", "Run `slopflow complete <issue-id>`.", 2);
  }
  if (!/^\d+$/.test(issueId)) {
    throw new SlopflowError("Issue id must be a plain number for the configured repository.", undefined, 2);
  }

  const root = findRepoRoot(process.cwd());
  if (!root) {
    throw new SlopflowError("Could not find a repository root.", "Run Slopflow inside an initialized repository.", 2);
  }
  const config = readMachineConfig(root);
  const workDir = join(root, config.artifact_root, issueId);
  const workStatusPath = join(workDir, "status.json");
  const workStatus = readWorkStatus(workDir, issueId, "complete");
  const issue = workStatus.issue;
  const issueText = `${issue.provider}:${issue.repo}#${issue.number}`;

  if (workStatus.status === "cancelled") {
    return completeBlocked(issueText, "issue work is cancelled", `inspect ${relativeToCwd(join(workDir, "cancel-note.md"))} or start new work`, workDir);
  }

  const contractPath = join(workDir, "contract.md");
  if (!existsSync(contractPath)) {
    return completeBlocked(issueText, "missing contract.md", "restore contract.md or rerun slopflow start", workDir);
  }
  if (!isJjStatusReadable(root)) {
    return completeBlocked(issueText, "jj status is not readable", "fix Jujutsu repository state", workDir);
  }

  const reviewPath = join(workDir, "review.json");
  if (!existsSync(reviewPath)) {
    return completeBlocked(issueText, "missing review verdict", `slopflow review ${issueId}`, workDir);
  }
  const reviewValidation = readAndValidateReviewVerdict(reviewPath);
  if (!reviewValidation.ok) {
    return completeBlocked(issueText, "invalid review verdict", "fix review.json", workDir);
  }
  if (reviewValidation.verdict.verdict !== "complete") {
    return completeBlocked(issueText, "review verdict is changes-requested", "address required changes", workDir);
  }

  const evidenceGate = evaluateCompletionEvidence(workDir);
  if (!evidenceGate.ok) {
    return completeBlocked(issueText, evidenceGate.reason, evidenceGate.nextStep, workDir);
  }

  const completionNotePath = join(workDir, "completion-note.md");
  if (!existsSync(completionNotePath)) {
    writeFileSync(
      completionNotePath,
      buildCompletionNote({ issue: issueText, testsStatus: evidenceGate.testsStatus, review: reviewValidation.verdict, workDir }),
      "utf8",
    );
  }

  const updatedStatus = { ...(readJson(workStatusPath) as Record<string, unknown>), status: "complete", completed_at: new Date().toISOString() };
  writeJson(workStatusPath, updatedStatus);

  printBlock("complete", {
    status: "complete",
    issue: issueText,
    tests: evidenceGate.testsStatus,
    review: "complete",
    "completion-note": relativeToCwd(completionNotePath),
    "next-step": "export/publish when ready",
  });
  return 0;
}

function completeBlocked(issue: string, reason: string, nextStep: string, workDir: string): number {
  printBlock("complete", {
    status: "blocked",
    issue,
    reason,
    "completion-note": relativeToCwd(join(workDir, "completion-note.md")),
    "next-step": nextStep,
  });
  return 2;
}

function evaluateCompletionEvidence(workDir: string): { ok: true; testsStatus: string } | { ok: false; reason: string; nextStep: string } {
  const testsPath = join(workDir, "evidence", "tests.json");
  if (!existsSync(testsPath)) {
    const exceptionPath = join(workDir, "evidence", "test-exception.md");
    if (existsSync(exceptionPath)) {
      return { ok: true, testsStatus: "exception-accepted" };
    }
    return {
      ok: false,
      reason: "missing test evidence",
      nextStep: "slopflow test <issue-id> --name <gate> -- <command>",
    };
  }

  const evidence = readTestEvidence(testsPath);
  const latest = Object.entries(evidence.latest);
  if (latest.length === 0) {
    return { ok: false, reason: "missing latest test gate", nextStep: "slopflow test <issue-id> --name <gate> -- <command>" };
  }
  const failed = latest.filter(([, gate]) => gate.status === "failed").map(([name]) => name);
  if (failed.length > 0) {
    return { ok: false, reason: `failed latest test gate: ${failed.join(", ")}`, nextStep: "fix failing gates and rerun slopflow test" };
  }
  const passed = latest.filter(([, gate]) => gate.status === "passed");
  if (passed.length === 0) {
    return { ok: false, reason: "no latest test gate passed", nextStep: "rerun a required quality gate with slopflow test" };
  }
  return { ok: true, testsStatus: "passed" };
}

function buildCompletionNote({ issue, testsStatus, review, workDir }: { issue: string; testsStatus: string; review: ReviewVerdict; workDir: string }): string {
  const testsSummary = buildTestEvidenceSummary(join(workDir, "evidence", "tests.json"));
  const exceptionPath = join(workDir, "evidence", "test-exception.md");
  const exception = existsSync(exceptionPath) ? readFileSync(exceptionPath, "utf8") : "";
  return `# Completion Note\n\n` +
    `Issue: ${issue}\n\n` +
    `## Summary\n\nLocal issue work passed Slopflow completion gates.\n\n` +
    `## Quality Gates\n\n` +
    `Tests: ${testsStatus}\n\n` +
    `${testsStatus === "exception-accepted" ? `Test exception accepted by reviewer:\n\n${indentBlock(exception)}\n\n` : `${testsSummary}\n\n`}` +
    `## Review\n\n` +
    `Verdict: ${review.verdict}\n\n` +
    `Reviewer: ${review.reviewer}\n\n` +
    `Reviewed at: ${review.reviewed_at}\n\n` +
    `${review.summary}\n\n` +
    `## Known Limitations / Follow-ups\n\nNone recorded.\n`;
}

function reviewCommand(issueId: string | undefined): number {
  if (!issueId) {
    throw new SlopflowError("Missing issue id.", "Run `slopflow review <issue-id>`.", 2);
  }
  if (!/^\d+$/.test(issueId)) {
    throw new SlopflowError("Issue id must be a plain number for the configured repository.", undefined, 2);
  }

  const root = findRepoRoot(process.cwd());
  if (!root) {
    throw new SlopflowError("Could not find a repository root.", "Run Slopflow inside an initialized repository.", 2);
  }
  const config = readMachineConfig(root);
  const workDir = join(root, config.artifact_root, issueId);
  const workStatus = readWorkStatus(workDir, issueId, "review");
  const issue = workStatus.issue;

  const testsPath = join(workDir, "evidence", "tests.json");
  const testEvidenceStatus = existsSync(testsPath) ? "present" : "missing";
  const reviewPath = join(workDir, "review.json");
  const packetPath = join(workDir, "review-packet.md");
  writeFileSync(packetPath, buildReviewPacket({ root, workDir, issue, testsPath }), "utf8");

  if (!existsSync(reviewPath)) {
    printBlock("review", {
      status: "pending",
      issue: `${issue.provider}:${issue.repo}#${issue.number}`,
      packet: relativeToCwd(packetPath),
      verdict: "missing",
      "test-evidence": testEvidenceStatus,
      "next-step": "ask reviewer to write review.json",
    });
    return 0;
  }

  const validation = readAndValidateReviewVerdict(reviewPath);
  if (!validation.ok) {
    printBlock("review", {
      status: "blocked",
      issue: `${issue.provider}:${issue.repo}#${issue.number}`,
      packet: relativeToCwd(packetPath),
      verdict: "invalid",
      "test-evidence": testEvidenceStatus,
      error: validation.error,
      "next-step": "fix review.json",
    });
    return 2;
  }

  const verdict = validation.verdict.verdict;
  printBlock("review", {
    status: verdict === "complete" ? "complete" : "changes-requested",
    issue: `${issue.provider}:${issue.repo}#${issue.number}`,
    packet: relativeToCwd(packetPath),
    verdict,
    "test-evidence": testEvidenceStatus,
    "next-step": verdict === "complete" ? `slopflow complete ${issueId}` : "address required changes",
  });
  return 0;
}

function readAndValidateReviewVerdict(path: string): { ok: true; verdict: ReviewVerdict } | { ok: false; error: string } {
  try {
    return validateReviewVerdict(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "review.json is invalid" };
  }
}

function testCommand(args: string[]): number {
  const { issueId, gateName, command } = parseTestArgs(args);
  const root = findRepoRoot(process.cwd());
  if (!root) {
    throw new SlopflowError("Could not find a repository root.", "Run Slopflow inside an initialized repository.", 2);
  }
  const config = readMachineConfig(root);
  const workDir = join(root, config.artifact_root, issueId);
  const workStatus = readWorkStatus(workDir, issueId, "test");

  const evidenceDir = join(workDir, "evidence");
  const logsDir = join(evidenceDir, "logs");
  mkdirSync(logsDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const attemptId = `${gateName}-${formatTimestampForId(startedAt)}`;
  const relativeLogPath = `evidence/logs/${attemptId}.txt`;
  const logPath = join(workDir, relativeLogPath);
  const result = spawnSync(command[0]!, command.slice(1), {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  const finishedAt = new Date().toISOString();
  const exitCode = typeof result.status === "number" ? result.status : 1;
  const status: TestAttempt["status"] = exitCode === 0 ? "passed" : "failed";
  const commandText = command.join(" ");

  writeFileSync(
    logPath,
    buildTestLog({
      attemptId,
      gateName,
      commandText,
      cwd: root,
      startedAt,
      finishedAt,
      exitCode,
      stdout: result.stdout ?? "",
      stderr: result.stderr || result.error?.message || "",
    }),
    "utf8",
  );

  const attempt: TestAttempt = {
    attempt_id: attemptId,
    name: gateName,
    command: commandText,
    status,
    exit_code: exitCode,
    log: relativeLogPath,
    started_at: startedAt,
    finished_at: finishedAt,
  };
  const evidencePath = join(evidenceDir, "tests.json");
  const evidence = readTestEvidence(evidencePath);
  evidence.attempts.push(attempt);
  evidence.latest[gateName] = {
    attempt_id: attempt.attempt_id,
    status: attempt.status,
    exit_code: attempt.exit_code,
    log: attempt.log,
  };
  writeJson(evidencePath, evidence);

  printBlock("test", {
    status,
    issue: `${workStatus.issue.provider}:${workStatus.issue.repo}#${workStatus.issue.number}`,
    gate: gateName,
    command: commandText,
    "exit-code": exitCode,
    log: relativeToCwd(logPath),
    evidence: relativeToCwd(evidencePath),
    "next-step": status === "passed" ? `slopflow review ${issueId}` : "fix implementation or create reviewed test exception",
  });
  return exitCode;
}

function lifecycleCommand(action: "pause" | "resume" | "cancel", args: string[]): number {
  const issueId = args[0];
  const reason = action === "resume" ? undefined : parseReasonArg(args.slice(1), action);
  const { root, workDir, workStatus, statusPath } = readLifecycleContext(issueId, action);
  const issue = workStatus.issue;
  const issueText = `${issue.provider}:${issue.repo}#${issue.number}`;
  const now = new Date().toISOString();

  if (action === "pause") {
    if (workStatus.status === "cancelled") {
      throw new SlopflowError("Cancelled issue work cannot be paused.", `Inspect ${relativeToCwd(join(workDir, "cancel-note.md"))}.`, 2);
    }
    if (workStatus.status === "complete") {
      throw new SlopflowError("Complete issue work cannot be paused.", `Inspect ${relativeToCwd(join(workDir, "completion-note.md"))}.`, 2);
    }
    const pauseNotePath = join(workDir, "pause-note.md");
    writeFileSync(pauseNotePath, buildLifecycleNote("Pause", issueText, reason!, now), "utf8");
    writeJson(statusPath, { ...workStatus, status: "paused", paused_at: now, pause_reason: reason });
    printBlock("pause", {
      status: "paused",
      issue: issueText,
      "pause-note": relativeToCwd(pauseNotePath),
      "next-step": `slopflow resume ${issueId}`,
    });
    return 0;
  }

  if (action === "cancel") {
    if (workStatus.status === "complete") {
      throw new SlopflowError("Complete issue work cannot be cancelled.", `Inspect ${relativeToCwd(join(workDir, "completion-note.md"))}.`, 2);
    }
    const cancelNotePath = join(workDir, "cancel-note.md");
    writeFileSync(cancelNotePath, buildLifecycleNote("Cancel", issueText, reason!, now), "utf8");
    writeJson(statusPath, { ...workStatus, status: "cancelled", cancelled_at: now, cancel_reason: reason });
    printBlock("cancel", {
      status: "cancelled",
      issue: issueText,
      "cancel-note": relativeToCwd(cancelNotePath),
      artifacts: "preserved",
      "next-step": "inspect artifacts or manually abandon related VCS work if desired",
    });
    return 0;
  }

  if (workStatus.status === "cancelled") {
    throw new SlopflowError("Cancelled issue work cannot be resumed.", `Inspect ${relativeToCwd(join(workDir, "cancel-note.md"))}.`, 2);
  }
  const wasPaused = workStatus.status === "paused";
  if (wasPaused) {
    writeJson(statusPath, { ...workStatus, status: "active", resumed_at: now });
  }
  const testsSummary = summarizeLatestTests(workDir);
  const reviewStatus = summarizeReviewVerdict(workDir);
  const completionStatus = existsSync(join(workDir, "completion-note.md")) || workStatus.status === "complete" ? "complete" : "incomplete";
  printBlock("resume", {
    status: wasPaused ? "active" : String(workStatus.status ?? "active"),
    issue: issueText,
    contract: relativeToCwd(join(workDir, "contract.md")),
    tests: testsSummary,
    review: reviewStatus,
    completion: completionStatus,
    "current-jj-change": readCurrentJjChange(root),
    "next-step": nextStepForWork(issueId!, workDir, reviewStatus, completionStatus),
  });
  return 0;
}

function readLifecycleContext(issueId: string | undefined, command: "pause" | "resume" | "cancel"): { root: string; workDir: string; workStatus: WorkStatus; statusPath: string } {
  if (!issueId) {
    throw new SlopflowError("Missing issue id.", `Run \`slopflow ${command} <issue-id>${command === "resume" ? "" : " --reason <text>"}\`.`, 2);
  }
  if (!/^\d+$/.test(issueId)) {
    throw new SlopflowError("Issue id must be a plain number for the configured repository.", undefined, 2);
  }
  const root = findRepoRoot(process.cwd());
  if (!root) {
    throw new SlopflowError("Could not find a repository root.", "Run Slopflow inside an initialized repository.", 2);
  }
  const config = readMachineConfig(root);
  const workDir = join(root, config.artifact_root, issueId);
  const statusPath = join(workDir, "status.json");
  return { root, workDir, statusPath, workStatus: readWorkStatus(workDir, issueId, command) };
}

function parseReasonArg(args: string[], command: "pause" | "cancel"): string {
  const reasonIndex = args.indexOf("--reason");
  const reason = reasonIndex >= 0 ? args[reasonIndex + 1] : undefined;
  if (!reason || reason.trim().length === 0) {
    throw new SlopflowError("Missing required `--reason <text>`.", `Run \`slopflow ${command} <issue-id> --reason <text>\`.`, 2);
  }
  return reason.trim();
}

function buildLifecycleNote(kind: "Pause" | "Cancel", issue: string, reason: string, timestamp: string): string {
  const verb = kind === "Pause" ? "Paused" : "Cancelled";
  return `# ${kind} Note\n\n` +
    `Issue: ${issue}\n\n` +
    `${verb} at: ${timestamp}\n\n` +
    `## Reason\n\n${reason}\n`;
}

function summarizeLatestTests(workDir: string): string {
  const testsPath = join(workDir, "evidence", "tests.json");
  if (!existsSync(testsPath)) return "missing";
  const evidence = readTestEvidence(testsPath);
  const latest = Object.entries(evidence.latest);
  if (latest.length === 0) return "missing";
  return latest.map(([name, gate]) => `${name}:${gate.status}`).join(",");
}

function summarizeReviewVerdict(workDir: string): string {
  const reviewPath = join(workDir, "review.json");
  if (!existsSync(reviewPath)) return "missing";
  const validation = readAndValidateReviewVerdict(reviewPath);
  return validation.ok ? validation.verdict.verdict : "invalid";
}

function nextStepForWork(issueId: string, workDir: string, reviewStatus: string, completionStatus: string): string {
  if (completionStatus === "complete") return "no local action required";
  if (summarizeLatestTests(workDir) === "missing") return `slopflow test ${issueId} --name <gate> -- <command>`;
  if (reviewStatus === "missing" || reviewStatus === "invalid") return `slopflow review ${issueId}`;
  if (reviewStatus === "changes-requested") return "address required changes";
  return `slopflow complete ${issueId}`;
}

function readWorkStatus(workDir: string, issueId: string, command: "test" | "review" | "complete" | "pause" | "resume" | "cancel"): WorkStatus {
  const workStatusPath = join(workDir, "status.json");
  if (!existsSync(workStatusPath)) {
    throw new SlopflowError(
      `Issue work status not found for #${issueId}.`,
      `Run \`slopflow start ${issueId}\` before ${workStatusCommandPhrase(command)}.`,
      2,
    );
  }
  const workStatus = readJson(workStatusPath) as Partial<WorkStatus>;
  if (!workStatus.issue) {
    throw new SlopflowError(
      `Issue work status is missing issue metadata for #${issueId}.`,
      "Inspect the work directory before retrying.",
      2,
    );
  }
  return workStatus as WorkStatus;
}

function workStatusCommandPhrase(command: "test" | "review" | "complete" | "pause" | "resume" | "cancel"): string {
  if (command === "test") return "capturing test evidence";
  if (command === "review") return "preparing review";
  if (command === "complete") return "completing work";
  if (command === "pause") return "pausing work";
  if (command === "resume") return "resuming work";
  return "cancelling work";
}

function parseTestArgs(args: string[]): { issueId: string; gateName: string; command: string[] } {
  const issueId = args[0];
  if (!issueId) {
    throw new SlopflowError("Missing issue id.", "Run `slopflow test <issue-id> --name <gate> -- <command...>`.", 2);
  }
  if (!/^\d+$/.test(issueId)) {
    throw new SlopflowError("Issue id must be a plain number for the configured repository.", undefined, 2);
  }
  const separatorIndex = args.indexOf("--");
  if (separatorIndex === -1) {
    throw new SlopflowError("Missing `--` before wrapped command.", "Run `slopflow test <issue-id> --name <gate> -- <command...>`.", 2);
  }
  const optionArgs = args.slice(1, separatorIndex);
  const command = args.slice(separatorIndex + 1);
  if (command.length === 0) {
    throw new SlopflowError("Missing wrapped command.", "Pass the command after `--`.", 2);
  }
  const nameIndex = optionArgs.indexOf("--name");
  const gateName = nameIndex >= 0 ? optionArgs[nameIndex + 1] : undefined;
  if (!gateName) {
    throw new SlopflowError("Missing required `--name <gate>`.", undefined, 2);
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(gateName)) {
    throw new SlopflowError(
      "Invalid gate name.",
      "Use lowercase letters, numbers, underscores, or hyphens; start with a letter or number.",
      2,
    );
  }
  return { issueId, gateName, command };
}

function startCommand(issueId: string | undefined): number {
  if (!issueId) {
    throw new SlopflowError("Missing issue id.", "Run `slopflow start <issue-id>`.", 2);
  }
  if (!/^\d+$/.test(issueId)) {
    throw new SlopflowError("Issue id must be a plain number for the configured repository.", undefined, 2);
  }

  const root = findRepoRoot(process.cwd());
  if (!root) {
    throw new SlopflowError(
      "Could not find a repository root.",
      "Run Slopflow inside an initialized repository.",
      2,
    );
  }
  const config = readMachineConfig(root);
  if (config.issue_tracker.type !== "github") {
    throw new SlopflowError("Unsupported issue tracker.", "Slopflow v0 start only supports GitHub.", 2);
  }

  const issueNumber = Number(issueId);
  const item = fetchGitHubItem(config.issue_tracker.repo, issueNumber);
  const issueReference: IssueReference = {
    provider: "github",
    repo: config.issue_tracker.repo,
    number: item.number,
    kind: item.kind,
  };
  const workDir = join(root, config.artifact_root, String(issueNumber));
  const statusPath = join(workDir, "status.json");

  let action = "created";
  if (existsSync(workDir)) {
    if (!existsSync(statusPath)) {
      throw new SlopflowError(
        `Work directory already exists without status metadata: ${relativeToCwd(workDir)}`,
        "Move it aside or inspect it before retrying.",
        2,
      );
    }
    const existing = readJson(statusPath) as { issue?: IssueReference };
    if (stableStringify(existing.issue) !== stableStringify(issueReference)) {
      throw new SlopflowError(
        `Work directory already exists for a different issue reference: ${relativeToCwd(workDir)}`,
        "Slopflow will not overwrite issue work automatically.",
        2,
      );
    }
    action = "unchanged";
  } else {
    mkdirSync(workDir, { recursive: true });
    const artifacts = buildStartArtifacts({ issue: item, issueReference, workDir, root });
    for (const [filename, content] of Object.entries(artifacts)) {
      writeFileSync(join(workDir, filename), content, "utf8");
    }
  }

  printBlock("start", {
    status: action,
    issue: `github:${issueReference.repo}#${issueReference.number}`,
    kind: issueReference.kind,
    "work-directory": relativeToCwd(workDir),
    contract: relativeToCwd(join(workDir, "contract.md")),
    "goal-prompt": relativeToCwd(join(workDir, "goal-prompt.md")),
    "next-step": `create goal mirror from ${relativeToCwd(join(workDir, "goal-prompt.md"))}`,
  });
  return 0;
}

function initCommand({ force }: { force: boolean }): number {
  const repo = discoverRepoContext(process.cwd());
  const configPath = join(repo.root, ".slopflow", "config.json");
  const workPath = join(repo.root, DEFAULT_ARTIFACT_ROOT);
  const desired = desiredConfig(repo.githubRepo);

  let action = "created";
  if (existsSync(configPath)) {
    const existing = readJson(configPath);
    if (stableStringify(existing) === stableStringify(desired)) {
      action = "unchanged";
    } else if (!force) {
      throw new SlopflowError(
        "Existing .slopflow/config.json differs from detected config.",
        "Re-run with `slopflow init --force` to intentionally refresh machine config.",
        2,
      );
    } else {
      action = "reinitialized";
    }
  }

  if (action !== "unchanged") {
    mkdirSync(dirname(configPath), { recursive: true });
    writeJson(configPath, desired);
  }
  mkdirSync(workPath, { recursive: true });

  printBlock("init", {
    status: action,
    repo: repo.githubRepo,
    vcs: "jj",
    config: relativeToCwd(configPath),
    "artifact-root": desired.artifact_root,
    "next-step": "slopflow status",
  });
  return 0;
}

async function statusCommand(): Promise<number> {
  const root = findRepoRoot(process.cwd());
  if (!root) {
    throw new SlopflowError(
      "Could not find a repository root.",
      "Run Slopflow inside a Jujutsu repository.",
      2,
    );
  }

  const config = readMachineConfig(root);
  const artifactRoot = String(config.artifact_root ?? DEFAULT_ARTIFACT_ROOT);
  const workRoot = join(root, artifactRoot);
  const workCounts = await countWorkDirsByStatus(workRoot);
  const currentJjChange = readCurrentJjChange(root);

  printBlock("status", {
    state: "initialized",
    repo: config.issue_tracker.repo,
    issue_tracker: config.issue_tracker.type,
    vcs: config.vcs.type,
    "artifact-root": artifactRoot,
    "current-jj-change": currentJjChange,
    "active-work-count": workCounts.active,
    "paused-work-count": workCounts.paused,
    "cancelled-work-count": workCounts.cancelled,
    "complete-work-count": workCounts.complete,
    "next-step": "slopflow start <issue-id>",
  });
  return 0;
}

function readMachineConfig(root: string): MachineConfig {
  const configPath = join(root, ".slopflow", "config.json");
  if (!existsSync(configPath)) {
    throw new SlopflowError("Slopflow machine config is missing.", "Run `slopflow init` first.", 2);
  }
  const config = readJson(configPath) as Partial<MachineConfig>;
  if (!config.artifact_root || !config.issue_tracker?.type || !config.issue_tracker.repo || !config.vcs?.type) {
    throw new SlopflowError("Slopflow machine config is incomplete.", "Run `slopflow init --force` to refresh it.", 2);
  }
  return config as MachineConfig;
}

function fetchGitHubItem(repo: string, number: number): GitHubItem {
  const issueArgs = ["issue", "view", String(number), "--repo", repo, "--json", "number,title,body,url,state"];
  const issue = runGhJson(issueArgs);
  if (issue.ok) {
    return normalizeGitHubItem(issue.value, "issue");
  }
  if (!issue.notFound) {
    throw githubCommandError(issue);
  }

  const prArgs = ["pr", "view", String(number), "--repo", repo, "--json", "number,title,body,url,state"];
  const pr = runGhJson(prArgs);
  if (pr.ok) {
    return normalizeGitHubItem(pr.value, "pull_request");
  }
  if (!pr.notFound) {
    throw githubCommandError(pr);
  }
  throw new SlopflowError(
    `Could not read GitHub issue or PR #${number} from ${repo}.`,
    "Ensure the issue or PR exists in the configured repository.",
    2,
    {
      command: `gh ${issueArgs.join(" ")} && gh ${prArgs.join(" ")}`,
      "exit-code": pr.exitCode,
      detail: summarizeCommandFailure(pr),
      "next-step": `verify #${number} exists in ${repo}`,
    },
  );
}

type GhJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; args: string[]; exitCode: number | string; stdout: string; stderr: string; message: string; notFound: boolean; spawnError?: string };

function runGhJson(args: string[]): GhJsonResult {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.error) {
    return {
      ok: false,
      args,
      exitCode: "spawn-error",
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      message: result.error.message,
      notFound: false,
      spawnError: result.error.message,
    };
  }
  if (result.status !== 0) {
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    return {
      ok: false,
      args,
      exitCode: typeof result.status === "number" ? result.status : 1,
      stdout,
      stderr,
      message: summarizeText(stderr || stdout || "gh command failed"),
      notFound: isLikelyNotFound(stdout, stderr),
    };
  }
  try {
    return { ok: true, value: JSON.parse(result.stdout) };
  } catch (error) {
    return {
      ok: false,
      args,
      exitCode: 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      message: error instanceof Error ? error.message : "GitHub JSON parse failed",
      notFound: false,
    };
  }
}

function githubCommandError(failure: Exclude<GhJsonResult, { ok: true }>): SlopflowError {
  return new SlopflowError(
    "GitHub command failed while reading issue work.",
    nextStepForGithubFailure(failure),
    2,
    {
      command: `gh ${failure.args.join(" ")}`,
      "exit-code": failure.exitCode,
      detail: summarizeCommandFailure(failure),
      "next-step": nextStepForGithubFailure(failure),
    },
  );
}

function summarizeCommandFailure(failure: Exclude<GhJsonResult, { ok: true }>): string {
  const parts = [failure.message, summarizeText(failure.stderr), summarizeText(failure.stdout)].filter(Boolean);
  return parts.length > 0 ? parts.join(" | ") : "gh command failed";
}

function summarizeText(value: string, limit = 300): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function isLikelyNotFound(stdout: string, stderr: string): boolean {
  const text = `${stdout}\n${stderr}`.toLowerCase();
  return /not found|could not resolve|no .* found|404/.test(text) && !isLikelyAuthFailure(stdout, stderr);
}

function isLikelyAuthFailure(stdout: string, stderr: string): boolean {
  return /auth|authentication|authorize|login|401|403|forbidden|permission/i.test(`${stdout}\n${stderr}`);
}

function nextStepForGithubFailure(failure: Exclude<GhJsonResult, { ok: true }>): string {
  if (failure.spawnError) {
    return "install GitHub CLI `gh` and ensure it is on PATH";
  }
  if (isLikelyAuthFailure(failure.stdout, failure.stderr)) {
    return "gh auth login";
  }
  if (failure.exitCode === 0) {
    return "inspect gh JSON output or update GitHub response parsing";
  }
  return "inspect gh output and retry";
}

function normalizeGitHubItem(value: unknown, kind: GitHubItem["kind"]): GitHubItem {
  const item = value as Partial<GitHubItem>;
  if (typeof item.number !== "number" || typeof item.title !== "string") {
    throw new SlopflowError("GitHub returned an unexpected issue shape.", undefined, 2);
  }
  return {
    number: item.number,
    title: item.title,
    body: typeof item.body === "string" ? item.body : "",
    url: typeof item.url === "string" ? item.url : "",
    state: typeof item.state === "string" ? item.state : "unknown",
    kind,
  };
}

function buildStartArtifacts({
  issue,
  issueReference,
  workDir,
  root,
}: {
  issue: GitHubItem;
  issueReference: IssueReference;
  workDir: string;
  root: string;
}): Record<string, string> {
  const contract = buildContract(issue, issueReference);
  const status = {
    schema_version: 1,
    status: "active",
    issue: issueReference,
    work_directory: relative(root, workDir),
    artifacts: {
      issue: "issue.md",
      contract: "contract.md",
      goal_prompt: "goal-prompt.md",
      next_steps: "next-steps.md",
    },
    created_by: "slopflow start",
  };
  return {
    "issue.md": buildIssueMarkdown(issue, issueReference),
    "contract.md": contract,
    "status.json": `${JSON.stringify(status, null, 2)}\n`,
    "goal-prompt.md": buildGoalPrompt(contract),
    "next-steps.md": buildNextSteps(issueReference),
  };
}

function buildIssueMarkdown(issue: GitHubItem, issueReference: IssueReference): string {
  return `# ${escapeMarkdown(issue.title)}\n\n` +
    `Issue: github:${issueReference.repo}#${issueReference.number}\n\n` +
    `Kind: ${issueReference.kind}\n\n` +
    `State: ${issue.state}\n\n` +
    `URL: ${issue.url}\n\n` +
    `## Body\n\n${issue.body || "_No issue body provided._"}\n`;
}

function buildContract(issue: GitHubItem, issueReference: IssueReference): string {
  return `# Issue Execution Contract\n\n` +
    `Issue: github:${issueReference.repo}#${issueReference.number}\n\n` +
    `## Issue Summary\n\n${issue.title}\n\n` +
    `## Acceptance Criteria\n\nExtract from the source issue before implementing. Source issue body:\n\n${indentBlock(issue.body || "No issue body provided.")}\n\n` +
    `## Constraints\n\n- Stay within the scope of github:${issueReference.repo}#${issueReference.number}.\n- Preserve Slopflow's CLI-runbook model; do not introduce autonomous orchestration unless explicitly approved.\n- Do not add dependencies without justification and review.\n\n` +
    `## Out of Scope\n\n- Work not requested by the source issue.\n- Publishing, pushing, merging, creating PRs, or closing issues unless separately requested.\n\n` +
    `## Required Quality Gates\n\n- Test evidence is required unless an explicit test exception is written and accepted by review.\n- Reviewer verdict is required before completion.\n- Browser or design evidence is required only if this contract is updated to require it.\n\n` +
    `## Blocked-Stop Conditions\n\n- Acceptance criteria cannot be extracted from the issue.\n- Required external tools or credentials are unavailable.\n- The implementation would expand beyond the source issue.\n- Quality gates cannot run and no reviewed test exception exists.\n\n` +
    `## Completion Criteria\n\n- Implementation matches the issue execution contract.\n- Required quality gates have evidence.\n- Reviewer verdict is complete.\n- Completion note summarizes changes, tests, review result, and limitations.\n`;
}

function buildGoalPrompt(contract: string): string {
  return `Create a Pi goal mirror from this Slopflow issue execution contract. The contract is canonical; the Pi goal is only a runtime mirror.\n\n${contract}`;
}

function buildNextSteps(issueReference: IssueReference): string {
  return `# Next Steps\n\n` +
    `1. Read \`contract.md\` and confirm scope for github:${issueReference.repo}#${issueReference.number}.\n` +
    `2. Create a Pi goal mirror from \`goal-prompt.md\` if working inside Pi.\n` +
    `3. Plan the smallest implementation that satisfies the contract.\n` +
    `4. Implement only the contract scope.\n` +
    `5. Capture test evidence with Slopflow when the test command exists.\n` +
    `6. Do not mark complete until reviewer verdict and required evidence exist.\n`;
}

function buildReviewPacket({ root, workDir, issue, testsPath }: { root: string; workDir: string; issue: IssueReference; testsPath: string }): string {
  const contractPath = join(workDir, "contract.md");
  const contract = existsSync(contractPath) ? readFileSync(contractPath, "utf8") : "_Missing contract.md_";
  const testsSummary = buildTestEvidenceSummary(testsPath);
  const jjStatus = runTextCommand("jj", ["--no-pager", "status"], root);
  const diff = runTextCommand("jj", ["--no-pager", "diff", "--git"], root);
  const boundedDiff = boundText(diff, REVIEW_DIFF_LIMIT);
  const changedFiles = changedFilesFromDiff(diff);

  return `# Review Packet\n\n` +
    `## Issue Reference\n\n` +
    `Issue: ${issue.provider}:${issue.repo}#${issue.number}\n\n` +
    `Kind: ${issue.kind}\n\n` +
    `## Reviewer Instructions\n\n` +
    `Review the diff against the issue execution contract. Slopflow does not create \`review.json\`; write it only if you are the reviewer.\n\n` +
    `Valid \`review.json\` schema:\n\n` +
    "```json\n" +
    JSON.stringify({
      schema_version: 1,
      verdict: "complete | changes-requested",
      reviewer: "reviewer-name",
      reviewed_at: new Date(0).toISOString(),
      summary: "Review summary",
      required_changes: [],
    }, null, 2) +
    "\n```\n\n" +
    `- Use \`verdict: "complete"\` only when no required changes remain.\n` +
    `- Use \`verdict: "changes-requested"\` with actionable \`required_changes\`.\n\n` +
    `## Contract\n\n` +
    "```markdown\n" + contract + "\n```\n\n" +
    `## Test Evidence Summary\n\n${testsSummary}\n\n` +
    `## Jujutsu Status\n\n` +
    "```text\n" + jjStatus + "\n```\n\n" +
    `## Changed Files\n\n${changedFiles.length > 0 ? changedFiles.map((file) => `- ${file}`).join("\n") : "_No changed files detected._"}\n\n` +
    `## Diff Excerpt\n\n` +
    `Inline diff limit: ${REVIEW_DIFF_LIMIT} characters. Run \`jj --no-pager diff --git\` for the full diff.\n\n` +
    "```diff\n" + boundedDiff.text + "\n```\n" +
    (boundedDiff.truncated ? "\n_Diff excerpt truncated._\n" : "");
}

function buildTestEvidenceSummary(testsPath: string): string {
  if (!existsSync(testsPath)) {
    return "Status: missing\n\nNo `evidence/tests.json` exists yet.";
  }
  const evidence = readTestEvidence(testsPath);
  const latestEntries = Object.entries(evidence.latest);
  if (latestEntries.length === 0) {
    return "Status: missing\n\n`evidence/tests.json` exists but has no latest gate results.";
  }
  const lines = ["Status: present", "", `Attempts: ${evidence.attempts.length}`, "", "Latest gates:"];
  for (const [name, latest] of latestEntries) {
    lines.push(`- ${name}: ${latest.status} (exit ${latest.exit_code}, log ${latest.log})`);
  }
  return lines.join("\n");
}

function runTextCommand(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.error) {
    return `unavailable: ${result.error.message}`;
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trimEnd();
}

function boundText(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, limit), truncated: true };
}

function changedFilesFromDiff(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split("\n")) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (match?.[2]) {
      files.add(match[2]);
    }
  }
  return [...files].sort();
}

function validateReviewVerdict(value: unknown): { ok: true; verdict: ReviewVerdict } | { ok: false; error: string } {
  const verdict = value as Partial<ReviewVerdict>;
  if (!verdict || typeof verdict !== "object") {
    return { ok: false, error: "review.json must be an object" };
  }
  if (verdict.schema_version !== 1) {
    return { ok: false, error: "schema_version must be 1" };
  }
  if (verdict.verdict !== "complete" && verdict.verdict !== "changes-requested") {
    return { ok: false, error: "verdict must be complete or changes-requested" };
  }
  if (!nonEmptyString(verdict.reviewer)) {
    return { ok: false, error: "reviewer must be a non-empty string" };
  }
  if (!nonEmptyString(verdict.reviewed_at) || !isIsoTimestamp(verdict.reviewed_at)) {
    return { ok: false, error: "reviewed_at must be an ISO timestamp" };
  }
  if (!nonEmptyString(verdict.summary)) {
    return { ok: false, error: "summary must be a non-empty string" };
  }
  if (!Array.isArray(verdict.required_changes) || !verdict.required_changes.every(nonEmptyString)) {
    return { ok: false, error: "required_changes must be an array of non-empty strings" };
  }
  if (verdict.verdict === "complete" && verdict.required_changes.length !== 0) {
    return { ok: false, error: "complete verdict requires empty required_changes" };
  }
  if (verdict.verdict === "changes-requested" && verdict.required_changes.length === 0) {
    return { ok: false, error: "changes-requested verdict requires required_changes" };
  }
  return { ok: true, verdict: verdict as ReviewVerdict };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && !Number.isNaN(Date.parse(value));
}

function indentBlock(value: string): string {
  return value
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function escapeMarkdown(value: string): string {
  return value.replace(/^#/gm, "\\#");
}

function discoverRepoContext(start: string): { root: string; githubRepo: string } {
  const root = findRepoRoot(start);
  if (!root) {
    throw new SlopflowError(
      "Could not find a repository root.",
      "Run `slopflow init` inside a Jujutsu repository with a GitHub origin remote.",
      2,
    );
  }
  if (!existsSync(join(root, ".jj"))) {
    throw new SlopflowError(
      "Jujutsu repository not detected.",
      "Initialize Jujutsu first; Slopflow v0 only supports jj-backed work.",
      2,
    );
  }
  if (!commandExists("jj")) {
    throw new SlopflowError("Jujutsu executable not found.", "Install `jj` before running `slopflow init`.", 2);
  }
  return { root, githubRepo: readGithubRepo(root) };
}

function findRepoRoot(start: string): string | null {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, ".jj")) || existsSync(join(current, ".git"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function readGithubRepo(root: string): string {
  const configPath = gitConfigPath(root);
  if (!existsSync(configPath)) {
    throw new SlopflowError(
      "Git config not found for GitHub remote detection.",
      "Use a colocated Jujutsu/Git repository with an origin remote.",
      2,
    );
  }
  const config = readFileSync(configPath, "utf8");
  const match = config.match(/\[remote "origin"\][\s\S]*?\n\s*url\s*=\s*(.+)\n?/);
  if (!match?.[1]) {
    throw new SlopflowError(
      "GitHub origin remote not found.",
      "Set origin to a GitHub repository before running `slopflow init`.",
      2,
    );
  }
  const repo = parseGithubRemote(match[1].trim());
  if (!repo) {
    throw new SlopflowError(
      `Origin remote is not a supported GitHub URL: ${match[1].trim()}`,
      "Use https://github.com/<owner>/<repo>.git or git@github.com:<owner>/<repo>.git.",
      2,
    );
  }
  return repo;
}

function gitConfigPath(root: string): string {
  const dotGit = join(root, ".git");
  try {
    const content = readFileSync(dotGit, "utf8").trim();
    const prefix = "gitdir:";
    if (content.toLowerCase().startsWith(prefix)) {
      const gitdir = content.slice(prefix.length).trim();
      return join(isAbsolute(gitdir) ? gitdir : join(root, gitdir), "config");
    }
  } catch {
    // `.git` is usually a directory. Fall through to the colocated config path.
  }
  return join(dotGit, "config");
}

function parseGithubRemote(url: string): string | null {
  const patterns = [
    /^https:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?\/?$/,
    /^git@github\.com:(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/,
    /^ssh:\/\/git@github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?\/?$/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.groups) {
      return `${match.groups.owner}/${match.groups.repo}`;
    }
  }
  return null;
}

function desiredConfig(githubRepo: string): MachineConfig {
  return {
    schema_version: SCHEMA_VERSION,
    artifact_root: DEFAULT_ARTIFACT_ROOT,
    issue_tracker: {
      type: "github",
      repo: githubRepo,
      prs_as_request_surface: DEFAULT_PRS_AS_REQUEST_SURFACE,
    },
    vcs: { type: "jj" },
  };
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new SlopflowError(`Invalid JSON in ${path}.`, error.message, 2);
    }
    throw error;
  }
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function readTestEvidence(path: string): TestEvidence {
  if (!existsSync(path)) {
    return { schema_version: 1, latest: {}, attempts: [] };
  }
  const existing = readJson(path) as Partial<TestEvidence>;
  return {
    schema_version: 1,
    latest: existing.latest ?? {},
    attempts: existing.attempts ?? [],
  };
}

function formatTimestampForId(value: string): string {
  return value.replace(/[:.]/g, "-");
}

function buildTestLog({
  attemptId,
  gateName,
  commandText,
  cwd,
  startedAt,
  finishedAt,
  exitCode,
  stdout,
  stderr,
}: {
  attemptId: string;
  gateName: string;
  commandText: string;
  cwd: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}): string {
  return `slopflow test log\n` +
    `attempt: ${attemptId}\n` +
    `gate: ${gateName}\n` +
    `command: ${commandText}\n` +
    `cwd: ${cwd}\n` +
    `started_at: ${startedAt}\n` +
    `finished_at: ${finishedAt}\n` +
    `exit_code: ${exitCode}\n\n` +
    `--- stdout ---\n${stdout}\n` +
    `--- stderr ---\n${stderr}\n`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function countWorkDirsByStatus(workRoot: string): Promise<{ active: number; paused: number; cancelled: number; complete: number }> {
  const counts = { active: 0, paused: 0, cancelled: 0, complete: 0 };
  try {
    const entries = await readdir(workRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const statusPath = join(workRoot, entry.name, "status.json");
      let status = "active";
      if (existsSync(statusPath)) {
        const value = readJson(statusPath) as { status?: string };
        status = value.status ?? "active";
      }
      if (status === "paused") counts.paused += 1;
      else if (status === "cancelled") counts.cancelled += 1;
      else if (status === "complete") counts.complete += 1;
      else counts.active += 1;
    }
    return counts;
  } catch {
    return counts;
  }
}

function readCurrentJjChange(root: string): string {
  const result = spawnSync("jj", ["--no-pager", "status"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.error) {
    return `unavailable: ${result.error.message}`;
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || "jj status failed";
    return `unavailable: ${detail}`;
  }
  for (const line of result.stdout.split("\n")) {
    if (line.includes("Working copy") && line.includes("(@)")) {
      return line.split(":").slice(1).join(":").trim();
    }
  }
  return "unknown";
}

function isJjStatusReadable(root: string): boolean {
  const result = spawnSync("jj", ["--no-pager", "status"], { cwd: root, encoding: "utf8" });
  return !result.error && result.status === 0;
}

function commandExists(command: string): boolean {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  return !result.error && result.status === 0;
}

function relativeToCwd(path: string): string {
  const relativePath = relative(process.cwd(), path);
  return relativePath.startsWith("..") ? path : relativePath || ".";
}

function printBlock(name: string, values: Record<string, unknown>, stream: NodeJS.WritableStream = process.stdout): void {
  stream.write(`${name}:\n`);
  for (const [key, value] of Object.entries(values)) {
    stream.write(`  ${key}: ${String(value)}\n`);
  }
}

function printHelp(): void {
  process.stdout.write(
    `Usage: slopflow <command>\n\nCommands:\n  init [--force]\n  status\n  doctor\n  start <issue-id>\n  pause <issue-id> --reason <text>\n  resume <issue-id>\n  cancel <issue-id> --reason <text>\n  test <issue-id> --name <gate> -- <command...>\n  review <issue-id>\n  complete <issue-id>\n`,
  );
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  process.exitCode = await main();
}

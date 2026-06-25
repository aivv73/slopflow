import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { parseAttemptIdArg, readAttemptOrThrow, readAttemptPointer } from "./attempts.js";
import { assertSafeWorkKey, attemptLockPath, boundText, buildTestEvidenceSummary, changedFilesFromDiff, findRepoRoot, isVcsStatusReadable, issueWorkLockPath, printBlock, readJson, readMachineConfig, readTestEvidence, readVcsDiff, readVcsStatus, readWorkStatus, relativeToCwd, resolveWorkDir, vcsDisplayName, withArtifactLock, writeJson } from "./infra.js";
import { workItemText } from "./issue-model.js";
import type { ArtifactLockScope, WorkItemReference, ReviewVerdict, TestAttempt, TestEvidence, WorkStatus } from "./types.js";
import { REVIEW_DIFF_LIMIT } from "./types.js";
import { SlopflowError } from "./types.js";

export function completeCommand(args: string[]): number {
  const issueId = args[0];
  const force = args.includes("--force");
  if (!issueId) {
    throw new SlopflowError("Missing issue id.", "Run `slopflow complete <issue-id>`.", 2);
  }
  assertSafeWorkKey(issueId);

  const executionRoot = findRepoRoot(process.cwd());
  if (!executionRoot) {
    throw new SlopflowError("Could not find a repository root.", "Run Slopflow inside an initialized repository.", 2);
  }
  const pointer = readAttemptPointer(executionRoot);
  const root = pointer?.canonical_repository ?? executionRoot;
  const config = readMachineConfig(root);
  const workDir = resolveWorkDir(root, config, issueId);
  const workStatusPath = join(workDir, "status.json");
  const workStatus = readWorkStatus(workDir, issueId, "complete");
  const issue = workStatus.issue;
  const workItemTextValue = workItemText(issue);
  const workspaceBlock = promotedWorkspaceBlock(workStatus, executionRoot, issueId, "complete");
  if (workspaceBlock) return completeBlocked(workItemTextValue, workspaceBlock.reason, workspaceBlock.nextStep, workDir);

  return withArtifactLock({ scope: "work", lockPath: issueWorkLockPath(workDir), force, command: "slopflow complete" }, () => {

  if (workStatus.status === "cancelled") {
    return completeBlocked(workItemTextValue, "issue work is cancelled", `inspect ${relativeToCwd(join(workDir, "cancel-note.md"))} or start new work`, workDir);
  }

  const contractPath = join(workDir, "contract.md");
  if (!existsSync(contractPath)) {
    return completeBlocked(workItemTextValue, "missing contract.md", "restore contract.md or rerun slopflow start", workDir);
  }
  if (!isVcsStatusReadable(executionRoot, config.vcs.type)) {
    return completeBlocked(workItemTextValue, `${config.vcs.type} status is not readable`, `fix ${vcsDisplayName(config.vcs.type)} repository state`, workDir);
  }

  const reviewPath = join(workDir, "review.json");
  if (!existsSync(reviewPath)) {
    return completeBlocked(workItemTextValue, "missing review verdict", `slopflow review ${issueId}`, workDir);
  }
  const reviewValidation = readAndValidateReviewVerdict(reviewPath);
  if (!reviewValidation.ok) {
    return completeBlocked(workItemTextValue, "invalid review verdict", "fix review.json", workDir);
  }
  if (reviewValidation.verdict.verdict !== "complete") {
    return completeBlocked(workItemTextValue, "review verdict is changes-requested", "address required changes", workDir);
  }

  const evidenceGate = evaluateCompletionEvidence(workDir);
  if (!evidenceGate.ok) {
    return completeBlocked(workItemTextValue, evidenceGate.reason, evidenceGate.nextStep, workDir);
  }

  const completionNotePath = join(workDir, "completion-note.md");
  if (!existsSync(completionNotePath)) {
    writeFileSync(
      completionNotePath,
      buildCompletionNote({ issue: workItemTextValue, testsStatus: evidenceGate.testsStatus, review: reviewValidation.verdict, workDir }),
      "utf8",
    );
  }

  const updatedStatus = { ...(readJson(workStatusPath) as Record<string, unknown>), status: "complete", completed_at: new Date().toISOString() };
  writeJson(workStatusPath, updatedStatus);

  printBlock("complete", {
    status: "complete",
    issue: workItemTextValue,
    tests: evidenceGate.testsStatus,
    review: "complete",
    "completion-note": relativeToCwd(completionNotePath),
    "next-step": "export/publish when ready",
  });
  return 0;
  });
}


export function completeBlocked(issue: string, reason: string, nextStep: string, workDir: string): number {
  printBlock("complete", {
    status: "blocked",
    issue,
    reason,
    "completion-note": relativeToCwd(join(workDir, "completion-note.md")),
    "next-step": nextStep,
  });
  return 2;
}


export function promotedWorkspaceBlock(workStatus: WorkStatus, executionRoot: string, issueId: string, command: "review" | "complete"): { reason: string; workspace: string; nextStep: string } | null {
  const workspace = typeof workStatus.execution_workspace_path === "string" ? workStatus.execution_workspace_path : "";
  if (!workspace) return null;
  const expected = normalizePathForCompare(workspace);
  const actual = normalizePathForCompare(executionRoot);
  if (expected === actual) return null;
  return {
    reason: `promoted issue work must be ${command === "review" ? "reviewed" : "completed"} from selected execution workspace`,
    workspace,
    nextStep: `cd ${workspace} && slopflow ${command} ${issueId}`,
  };
}


export function normalizePathForCompare(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}


export function evaluateCompletionEvidence(workDir: string): { ok: true; testsStatus: string } | { ok: false; reason: string; nextStep: string } {
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


export function buildCompletionNote({ issue, testsStatus, review, workDir }: { issue: string; testsStatus: string; review: ReviewVerdict; workDir: string }): string {
  const testsSummary = buildTestEvidenceSummary(join(workDir, "evidence", "tests.json"));
  const exceptionPath = join(workDir, "evidence", "test-exception.md");
  const exception = existsSync(exceptionPath) ? readFileSync(exceptionPath, "utf8") : "";
  return `# Completion Note\n\n` +
    `Work item: ${issue}\n\n` +
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


export function reviewCommand(args: string[]): number {
  const issueId = args[0];
  const force = args.includes("--force");
  if (!issueId) {
    throw new SlopflowError("Missing issue id.", "Run `slopflow review <issue-id>`.", 2);
  }
  assertSafeWorkKey(issueId);

  const executionRoot = findRepoRoot(process.cwd());
  if (!executionRoot) {
    throw new SlopflowError("Could not find a repository root.", "Run Slopflow inside an initialized repository.", 2);
  }
  const pointer = readAttemptPointer(executionRoot);
  const root = pointer?.canonical_repository ?? executionRoot;
  const config = readMachineConfig(root);
  const workDir = resolveWorkDir(root, config, issueId);
  const workStatus = readWorkStatus(workDir, issueId, "review");
  const issue = workStatus.issue;
  const workspaceBlock = promotedWorkspaceBlock(workStatus, executionRoot, issueId, "review");
  if (workspaceBlock) {
    printBlock("review", {
      status: "blocked",
      issue: workItemText(issue),
      reason: workspaceBlock.reason,
      "execution-workspace": workspaceBlock.workspace,
      "next-step": workspaceBlock.nextStep,
    });
    return 2;
  }

  return withArtifactLock({ scope: "work", lockPath: issueWorkLockPath(workDir), force, command: "slopflow review" }, () => {

  const testsPath = join(workDir, "evidence", "tests.json");
  const testEvidenceStatus = existsSync(testsPath) ? "present" : "missing";
  const reviewPath = join(workDir, "review.json");
  const packetPath = join(workDir, "review-packet.md");
  writeFileSync(packetPath, buildReviewPacket({ root: executionRoot, workDir, issue, testsPath, vcs: config.vcs.type }), "utf8");

  if (!existsSync(reviewPath)) {
    printBlock("review", {
      status: "pending",
      issue: workItemText(issue),
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
      issue: workItemText(issue),
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
    issue: workItemText(issue),
    packet: relativeToCwd(packetPath),
    verdict,
    "test-evidence": testEvidenceStatus,
    "next-step": verdict === "complete" ? `slopflow complete ${issueId}` : "address required changes",
  });
  return 0;
  });
}


export function readAndValidateReviewVerdict(path: string): { ok: true; verdict: ReviewVerdict } | { ok: false; error: string } {
  try {
    return validateReviewVerdict(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "review.json is invalid" };
  }
}


export function testCommand(args: string[]): number {
  const { issueId, gateName, command, attemptId: agentAttemptId } = parseTestArgs(args);
  const force = args.includes("--force");
  const executionRoot = findRepoRoot(process.cwd());
  if (!executionRoot) {
    throw new SlopflowError("Could not find a repository root.", "Run Slopflow inside an initialized repository.", 2);
  }
  const pointer = agentAttemptId ? readAttemptPointer(executionRoot) : null;
  if (pointer && pointer.issue_id !== issueId) {
    throw new SlopflowError("Attempt workspace pointer issue does not match requested issue.", `Run \`slopflow test ${pointer.issue_id} --attempt ${pointer.attempt_id} ...\` from this workspace.`, 2);
  }
  if (pointer && pointer.attempt_id !== agentAttemptId) {
    throw new SlopflowError("Attempt workspace pointer attempt does not match requested attempt.", `Use --attempt ${pointer.attempt_id} from this workspace.`, 2);
  }
  const root = pointer?.canonical_repository ?? executionRoot;
  const config = readMachineConfig(root);
  const workDir = resolveWorkDir(root, config, issueId);
  const workStatus = readWorkStatus(workDir, issueId, "test");
  const targetDir = agentAttemptId ? join(workDir, "attempts", agentAttemptId) : workDir;
  if (agentAttemptId) readAttemptOrThrow(join(workDir, "attempts"), agentAttemptId);
  const lockScope: ArtifactLockScope = agentAttemptId ? "attempt" : "work";
  const lockPath = agentAttemptId ? attemptLockPath(targetDir) : issueWorkLockPath(workDir);

  return withArtifactLock({ scope: lockScope, lockPath, force, command: "slopflow test" }, () => {

  const evidenceDir = join(targetDir, "evidence");
  const logsDir = join(evidenceDir, "logs");
  mkdirSync(logsDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const testAttemptId = `${gateName}-${formatTimestampForId(startedAt)}`;
  const relativeLogPath = `evidence/logs/${testAttemptId}.txt`;
  const logPath = join(targetDir, relativeLogPath);
  const result = spawnSync(command[0]!, command.slice(1), {
    cwd: executionRoot,
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
      attemptId: testAttemptId,
      gateName,
      commandText,
      cwd: executionRoot,
      startedAt,
      finishedAt,
      exitCode,
      stdout: result.stdout ?? "",
      stderr: result.stderr || result.error?.message || "",
    }),
    "utf8",
  );

  const attempt: TestAttempt = {
    attempt_id: testAttemptId,
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
    issue: workItemText(workStatus.issue),
    gate: gateName,
    command: commandText,
    "exit-code": exitCode,
    log: relativeToCwd(logPath),
    evidence: relativeToCwd(evidencePath),
    "next-step": agentAttemptId ? `slopflow attempt submit ${issueId} ${agentAttemptId}` : (status === "passed" ? `slopflow review ${issueId}` : "fix implementation or create reviewed test exception"),
  });
  return exitCode;
  });
}


export function summarizeLatestTests(workDir: string): string {
  const testsPath = join(workDir, "evidence", "tests.json");
  if (!existsSync(testsPath)) return "missing";
  const evidence = readTestEvidence(testsPath);
  const latest = Object.entries(evidence.latest);
  if (latest.length === 0) return "missing";
  return latest.map(([name, gate]) => `${name}:${gate.status}`).join(",");
}


export function summarizeReviewVerdict(workDir: string): string {
  const reviewPath = join(workDir, "review.json");
  if (!existsSync(reviewPath)) return "missing";
  const validation = readAndValidateReviewVerdict(reviewPath);
  return validation.ok ? validation.verdict.verdict : "invalid";
}


export function nextStepForWork(issueId: string, workDir: string, reviewStatus: string, completionStatus: string): string {
  if (completionStatus === "complete") return "no local action required";
  if (summarizeLatestTests(workDir) === "missing") return `slopflow test ${issueId} --name <gate> -- <command>`;
  if (reviewStatus === "missing" || reviewStatus === "invalid") return `slopflow review ${issueId}`;
  if (reviewStatus === "changes-requested") return "address required changes";
  return `slopflow complete ${issueId}`;
}


export function parseTestArgs(args: string[]): { issueId: string; gateName: string; command: string[]; attemptId?: string } {
  const issueId = args[0];
  if (!issueId) {
    throw new SlopflowError("Missing issue id.", "Run `slopflow test <issue-id> --name <gate> -- <command...>`.", 2);
  }
  assertSafeWorkKey(issueId);
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
  const attemptIndex = optionArgs.indexOf("--attempt");
  const attemptId = attemptIndex >= 0 ? optionArgs[attemptIndex + 1] : undefined;
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
  if (attemptIndex >= 0) {
    parseAttemptIdArg(attemptId, "slopflow test <issue-id> --attempt <attempt-id> --name <gate> -- <command...>");
  }
  return { issueId, gateName, command, ...(attemptId ? { attemptId } : {}) };
}


export function buildReviewPacket({ root, workDir, issue, testsPath, vcs }: { root: string; workDir: string; issue: WorkItemReference; testsPath: string; vcs: string }): string {
  const contractPath = join(workDir, "contract.md");
  const contract = existsSync(contractPath) ? readFileSync(contractPath, "utf8") : "_Missing contract.md_";
  const testsSummary = buildTestEvidenceSummary(testsPath);
  const vcsStatus = readVcsStatus(root, vcs);
  const diff = readVcsDiff(root, vcs);
  const boundedDiff = boundText(diff, REVIEW_DIFF_LIMIT);
  const changedFiles = changedFilesFromDiff(diff);
  const statusHeading = vcs === "jj" ? "Jujutsu Status" : vcs === "git" ? "Git Status" : "VCS Status";
  const diffCommand = vcs === "jj" ? "jj --no-pager diff --git" : vcs === "git" ? "git diff -- ." : "the configured VCS diff command";

  return `# Review Packet\n\n` +
    `## Work Item Reference\n\n` +
    `Work item: ${workItemText(issue)}\n\n` +
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
    `## ${statusHeading}\n\n` +
    "```text\n" + vcsStatus + "\n```\n\n" +
    `## Changed Files\n\n${changedFiles.length > 0 ? changedFiles.map((file) => `- ${file}`).join("\n") : "_No changed files detected._"}\n\n` +
    `## Diff Excerpt\n\n` +
    `Inline diff limit: ${REVIEW_DIFF_LIMIT} characters. Run \`${diffCommand}\` for the full diff.\n\n` +
    "```diff\n" + boundedDiff.text + "\n```\n" +
    (boundedDiff.truncated ? "\n_Diff excerpt truncated._\n" : "");
}


export function validateReviewVerdict(value: unknown): { ok: true; verdict: ReviewVerdict } | { ok: false; error: string } {
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


export function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}


export function isIsoTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && !Number.isNaN(Date.parse(value));
}


export function indentBlock(value: string): string {
  return value
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}


export function escapeMarkdown(value: string): string {
  return value.replace(/^#/gm, "\\#");
}



export function formatTimestampForId(value: string): string {
  return value.replace(/[:.]/g, "-");
}


export function buildTestLog({
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


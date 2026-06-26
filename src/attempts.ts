import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { assertSafeWorkKey, attemptLockPath, boundText, buildTestEvidenceSummary, changedFilesFromDiff, findRepoRoot, issueWorkLockPath, parseReasonArg, printBlock, readJson, readMachineConfig, readWorkStatus, readdirSyncSafe, relativeToCwd, resolveWorkDir, runTextCommand, selectionLockPath, withArtifactLock, writeJson } from "./infra.js";
import { workItemText, summarizeText } from "./issue-model.js";
import type { AgentAttempt, AttemptWorkspace, AttemptWorkspacePointer, WorkItemReference, MachineConfig, WorkStatus } from "./types.js";
import { REVIEW_DIFF_LIMIT } from "./types.js";
import { SlopflowError } from "./types.js";

export function attemptCommand(args: string[]): number {
  const [subcommand, ...rest] = args;
  if (!subcommand) {
    throw new SlopflowError("Missing attempt subcommand.", "Run `slopflow attempt create|list|status|submit|abandon ...`.", 2);
  }
  if (subcommand === "create") return attemptCreateCommand(rest);
  if (subcommand === "list") return attemptListCommand(rest);
  if (subcommand === "status") return attemptStatusCommand(rest);
  if (subcommand === "submit") return attemptSubmitCommand(rest);
  if (subcommand === "abandon") return attemptAbandonCommand(rest);
  if (subcommand === "compare") return attemptCompareCommand(rest);
  if (subcommand === "select") return attemptSelectCommand(rest);
  if (subcommand === "promote") return attemptPromoteCommand(rest);
  throw new SlopflowError(`Unknown attempt subcommand: ${subcommand}`, "Run `slopflow attempt create|list|status|submit|abandon|compare|select|promote ...`.", 2);
}


export function attemptCreateCommand(args: string[]): number {
  const issueId = parseIssueIdArg(args[0], "slopflow attempt create <issue-id> [--count <n>]");
  const force = args.includes("--force");
  const count = parseAttemptCount(args.slice(1));
  const { root, workDir, workStatus } = readAttemptContext(issueId);
  const config = readMachineConfig(root);
  return withArtifactLock({ scope: "work", lockPath: issueWorkLockPath(workDir), force, command: "slopflow attempt create" }, () => {
    const attemptsRoot = join(workDir, "attempts");
    mkdirSync(attemptsRoot, { recursive: true });

    const created: AgentAttempt[] = [];
    for (let index = 0; index < count; index += 1) {
      const attemptId = nextAttemptId(attemptsRoot);
      const now = new Date().toISOString();
      const attempt: AgentAttempt = {
        schema_version: 1,
        issue_id: issueId,
        attempt_id: attemptId,
        status: "created",
        created_at: now,
        updated_at: now,
      };
      const attemptDir = join(attemptsRoot, attemptId);
      mkdirSync(attemptDir, { recursive: true });
      try {
        const workspace = createAttemptWorkspace({ root, config, issueId, attemptId });
        writeJson(join(attemptDir, "workspace.json"), workspace);
        writeAttemptWorkspacePointer({ workspacePath: workspace.path, canonicalRepository: root, issueId, attemptId });
        writeJson(join(attemptDir, "attempt.json"), attempt);
        writeFileSync(join(attemptDir, "goal-prompt.md"), buildAttemptGoalPrompt(workStatus.issue, attemptId, workspace.path), "utf8");
        mkdirSync(join(attemptDir, "evidence"), { recursive: true });
        created.push(attempt);
      } catch (error) {
        rmSync(attemptDir, { recursive: true, force: true });
        throw error;
      }
    }

    printBlock("attempt", {
      status: "created",
      issue: workItemText(workStatus.issue),
      "created-count": created.length,
      attempts: created.map((attempt) => attempt.attempt_id).join(","),
      "next-step": `cd <attempt-workspace>, write summary.md, then slopflow attempt submit ${issueId} <attempt-id>`,
    });
    return 0;
  });
}


export function attemptListCommand(args: string[]): number {
  const issueId = parseIssueIdArg(args[0], "slopflow attempt list <issue-id>");
  const { workStatus, attemptsRoot } = readAttemptContext(issueId);
  const attempts = listAttempts(attemptsRoot);
  printBlock("attempts", {
    status: "listed",
    issue: workItemText(workStatus.issue),
    count: attempts.length,
    attempts: attempts.map((attempt) => `${attempt.attempt_id}:${attempt.status}`).join(",") || "none",
    "next-step": attempts.length > 0 ? `slopflow attempt status ${issueId} <attempt-id>` : `slopflow attempt create ${issueId}`,
  });
  return 0;
}


export function attemptStatusCommand(args: string[]): number {
  const issueId = parseIssueIdArg(args[0], "slopflow attempt status <issue-id> [attempt-id]");
  const { workStatus, attemptsRoot } = readAttemptContext(issueId);
  const attemptId = args[1];
  if (!attemptId) {
    const attempts = listAttempts(attemptsRoot);
    printBlock("attempts", {
      status: "listed",
      issue: workItemText(workStatus.issue),
      count: attempts.length,
      attempts: attempts.map((attempt) => `${attempt.attempt_id}:${attempt.status}`).join(",") || "none",
      "next-step": attempts.length > 0 ? `slopflow attempt status ${issueId} <attempt-id>` : `slopflow attempt create ${issueId}`,
    });
    return 0;
  }
  const attempt = readAttemptOrThrow(attemptsRoot, attemptId);
  const attemptDir = join(attemptsRoot, attemptId);
  printBlock("attempt", {
    status: attempt.status,
    issue: workItemText(workStatus.issue),
    attempt: attempt.attempt_id,
    summary: existsSync(join(attemptDir, "summary.md")) ? "present" : "missing",
    evidence: existsSync(join(attemptDir, "evidence", "tests.json")) ? "present" : "missing",
    "updated-at": attempt.updated_at,
    "next-step": nextStepForAttempt(issueId, attempt, attemptDir),
  });
  return 0;
}


export function attemptSubmitCommand(args: string[]): number {
  const issueId = parseIssueIdArg(args[0], "slopflow attempt submit <issue-id> <attempt-id>");
  const attemptId = parseAttemptIdArg(args[1], "slopflow attempt submit <issue-id> <attempt-id>");
  const force = args.includes("--force");
  const { workStatus, attemptsRoot } = readAttemptContext(issueId);
  const attemptDir = join(attemptsRoot, attemptId);
  return withArtifactLock({ scope: "attempt", lockPath: attemptLockPath(attemptDir), force, command: "slopflow attempt submit" }, () => {
    const attempt = readAttemptOrThrow(attemptsRoot, attemptId);
    const summaryPath = join(attemptDir, "summary.md");
    if (!existsSync(summaryPath)) {
      printBlock("attempt", {
        status: "blocked",
        issue: workItemText(workStatus.issue),
        attempt: attemptId,
        reason: "missing summary.md",
        summary: relativeToCwd(summaryPath),
        "next-step": `write ${relativeToCwd(summaryPath)}, then rerun slopflow attempt submit ${issueId} ${attemptId}`,
      });
      return 2;
    }
    if (attempt.status === "abandoned") {
      throw new SlopflowError("Abandoned attempt cannot be submitted.", `Inspect ${relativeToCwd(join(attemptDir, "attempt.json"))}.`, 2);
    }
    const now = new Date().toISOString();
    const updated: AgentAttempt = { ...attempt, status: "submitted", submitted_at: attempt.submitted_at ?? now, updated_at: now };
    writeJson(join(attemptDir, "attempt.json"), updated);
    printBlock("attempt", {
      status: "submitted",
      issue: workItemText(workStatus.issue),
      attempt: attemptId,
      summary: relativeToCwd(summaryPath),
      "next-step": `slopflow attempt status ${issueId} ${attemptId}`,
    });
    return 0;
  });
}


export function attemptAbandonCommand(args: string[]): number {
  const issueId = parseIssueIdArg(args[0], "slopflow attempt abandon <issue-id> <attempt-id> --reason <text>");
  const attemptId = parseAttemptIdArg(args[1], "slopflow attempt abandon <issue-id> <attempt-id> --reason <text>");
  const force = args.includes("--force");
  const reason = parseReasonArg(args.slice(2), "abandon");
  const { workStatus, attemptsRoot } = readAttemptContext(issueId);
  const attemptDir = join(attemptsRoot, attemptId);
  return withArtifactLock({ scope: "attempt", lockPath: attemptLockPath(attemptDir), force, command: "slopflow attempt abandon" }, () => {
    const attempt = readAttemptOrThrow(attemptsRoot, attemptId);
    if (attempt.status === "selected") {
      throw new SlopflowError("Selected attempt cannot be abandoned.", "Select another attempt before abandoning this one.", 2);
    }
    const now = new Date().toISOString();
    const updated: AgentAttempt = { ...attempt, status: "abandoned", abandoned_at: now, abandon_reason: reason, updated_at: now };
    writeJson(join(attemptDir, "attempt.json"), updated);
    writeFileSync(join(attemptDir, "abandon-note.md"), buildAttemptAbandonNote(workStatus.issue, attemptId, reason, now), "utf8");
    printBlock("attempt", {
      status: "abandoned",
      issue: workItemText(workStatus.issue),
      attempt: attemptId,
      "abandon-note": relativeToCwd(join(attemptDir, "abandon-note.md")),
      artifacts: "preserved",
      "next-step": `slopflow attempt list ${issueId}`,
    });
    return 0;
  });
}


export function attemptCompareCommand(args: string[]): number {
  const issueId = parseIssueIdArg(args[0], "slopflow attempt compare <issue-id>");
  const force = args.includes("--force");
  const { workDir, workStatus, attemptsRoot } = readAttemptContext(issueId);
  return withArtifactLock({ scope: "work", lockPath: issueWorkLockPath(workDir), force, command: "slopflow attempt compare" }, () => {
    const attempts = listAttempts(attemptsRoot);
    const submitted = attempts.filter((attempt) => attempt.status === "submitted" || attempt.status === "selected");
    const comparisonPath = join(workDir, "attempt-comparison.md");
    writeFileSync(comparisonPath, buildAttemptComparison({ workDir, attempts: submitted }), "utf8");
    printBlock("attempt-comparison", {
      status: "created",
      issue: workItemText(workStatus.issue),
      attempts: submitted.length,
      comparison: relativeToCwd(comparisonPath),
      "next-step": submitted.length > 0 ? `review ${relativeToCwd(comparisonPath)} and run slopflow attempt select ${issueId} <attempt-id> --reason <text>` : `submit attempts with slopflow attempt submit ${issueId} <attempt-id>`,
    });
    return 0;
  });
}


export function buildAttemptComparison({ workDir, attempts }: { workDir: string; attempts: AgentAttempt[] }): string {
  const sections = attempts.map((attempt) => buildAttemptComparisonSection(workDir, attempt));
  return `# Attempt Comparison\n\n` +
    `Submitted attempts: ${attempts.length}\n\n` +
    `This artifact is a comparison aid only. It does not select an attempt, approve work, write \`review.json\`, or complete issue work.\n\n` +
    (sections.length > 0 ? sections.join("\n\n") : "_No submitted attempts._\n");
}


export function buildAttemptComparisonSection(workDir: string, attempt: AgentAttempt): string {
  const attemptDir = join(workDir, "attempts", attempt.attempt_id);
  const summaryPath = join(attemptDir, "summary.md");
  const workspacePath = join(attemptDir, "workspace.json");
  const evidencePath = join(attemptDir, "evidence", "tests.json");
  const summary = existsSync(summaryPath) ? readFileSync(summaryPath, "utf8").trim() : "_Missing summary.md_";
  const evidenceSummary = buildTestEvidenceSummary(evidencePath);
  const workspace = existsSync(workspacePath) ? readJson(workspacePath) as AttemptWorkspace : null;
  const diff = workspace?.path && existsSync(workspace.path) ? runWorkspaceDiff(workspace) : "";
  const boundedDiff = boundText(diff, Math.min(REVIEW_DIFF_LIMIT, 20_000));
  const changedFiles = changedFilesFromDiff(diff);
  return `## ${attempt.attempt_id}\n\n` +
    `Status: ${attempt.status}\n\n` +
    `Updated at: ${attempt.updated_at}\n\n` +
    `### Summary\n\n${summary}\n\n` +
    `### Test Evidence\n\n${evidenceSummary}\n\n` +
    `### Workspace\n\n` +
    (workspace ? `Kind: ${workspace.kind}\n\nPath: ${workspace.path}\n\n` : `_Missing workspace.json_\n\n`) +
    `### Changed Files\n\n${changedFiles.length > 0 ? changedFiles.map((file) => `- ${file}`).join("\n") : "_No changed files detected or diff unavailable._"}\n\n` +
    `### Diff Excerpt\n\n` +
    `Inline diff limit: ${Math.min(REVIEW_DIFF_LIMIT, 20_000)} characters.\n\n` +
    "```diff\n" + boundedDiff.text + "\n```\n" +
    (boundedDiff.truncated ? "\n_Diff excerpt truncated._\n" : "");
}


export function runWorkspaceDiff(workspace: AttemptWorkspace): string {
  if (workspace.kind === "jj-workspace") return runTextCommand("jj", ["--no-pager", "diff", "--git"], workspace.path);
  if (workspace.kind === "git-worktree") return runTextCommand("git", ["diff", "--", "."], workspace.path);
  return "";
}


export function attemptSelectCommand(args: string[]): number {
  const issueId = parseIssueIdArg(args[0], "slopflow attempt select <issue-id> <attempt-id> --reason <text>");
  const attemptId = parseAttemptIdArg(args[1], "slopflow attempt select <issue-id> <attempt-id> --reason <text>");
  const force = args.includes("--force");
  const reason = parseReasonArg(args.slice(2), "select");
  const { workDir, workStatus, attemptsRoot } = readAttemptContext(issueId);
  return withArtifactLock({ scope: "selection", lockPath: selectionLockPath(workDir), force, command: "slopflow attempt select" }, () => {
    const selectionPath = join(workDir, "selection.json");
    if (existsSync(selectionPath) && !force) {
      throw new SlopflowError(
        "Selected attempt already exists.",
        "Inspect selection.json or rerun with --force to supersede it.",
        2,
        {
          scope: "selection",
          selection: relativeToCwd(selectionPath),
          "next-step": "inspect selection.json or rerun slopflow attempt select with --force",
        },
      );
    }
    const attempt = readAttemptOrThrow(attemptsRoot, attemptId);
    if (attempt.status !== "submitted" && attempt.status !== "selected") {
      throw new SlopflowError("Only submitted attempts can be selected.", `Run \`slopflow attempt submit ${issueId} ${attemptId}\` first.`, 2);
    }
    const now = new Date().toISOString();
    for (const existing of listAttempts(attemptsRoot)) {
      if (existing.attempt_id === attemptId) {
        writeJson(join(attemptsRoot, existing.attempt_id, "attempt.json"), { ...existing, status: "selected", updated_at: now });
      } else if (existing.status === "submitted" || existing.status === "selected") {
        writeJson(join(attemptsRoot, existing.attempt_id, "attempt.json"), { ...existing, status: "rejected", updated_at: now });
      }
    }
    writeJson(selectionPath, {
      schema_version: 1,
      issue_id: issueId,
      selected_attempt_id: attemptId,
      selected_at: now,
      selected_by: process.env.USER || "unknown",
      reason,
    });
    printBlock("attempt-selection", {
      status: "selected",
      issue: workItemText(workStatus.issue),
      attempt: attemptId,
      selection: relativeToCwd(selectionPath),
      "next-step": `slopflow attempt status ${issueId} ${attemptId}`,
    });
    return 0;
  });
}


export function attemptPromoteCommand(args: string[]): number {
  const issueId = parseIssueIdArg(args[0], "slopflow attempt promote <issue-id>");
  const force = args.includes("--force");
  const { workDir, workStatus, attemptsRoot } = readAttemptContext(issueId);
  return withArtifactLock({ scope: "work", lockPath: issueWorkLockPath(workDir), force, command: "slopflow attempt promote" }, () => {
    const selectionPath = join(workDir, "selection.json");
    if (!existsSync(selectionPath)) {
      throw new SlopflowError("Missing selected-attempt decision.", `Run \`slopflow attempt select ${issueId} <attempt-id> --reason <text>\` first.`, 2);
    }
    const selection = readJson(selectionPath) as { selected_attempt_id?: unknown };
    const selectedAttemptId = typeof selection.selected_attempt_id === "string" ? selection.selected_attempt_id : "";
    const attempt = readAttemptOrThrow(attemptsRoot, selectedAttemptId);
    if (attempt.status !== "selected") {
      throw new SlopflowError("Selected attempt artifact is not marked selected.", `Inspect ${relativeToCwd(join(attemptsRoot, selectedAttemptId, "attempt.json"))}.`, 2);
    }
    const attemptDir = join(attemptsRoot, selectedAttemptId);
    const workspacePath = join(attemptDir, "workspace.json");
    if (!existsSync(workspacePath)) {
      throw new SlopflowError("Selected attempt workspace metadata is missing.", `Restore ${relativeToCwd(workspacePath)} before promotion.`, 2);
    }
    const workspace = readJson(workspacePath) as AttemptWorkspace;
    const sourceEvidenceDir = join(attemptDir, "evidence");
    const targetEvidenceDir = join(workDir, "evidence");
    if (existsSync(sourceEvidenceDir)) {
      rmSync(targetEvidenceDir, { recursive: true, force: true });
      cpSync(sourceEvidenceDir, targetEvidenceDir, { recursive: true });
    }
    const now = new Date().toISOString();
    const promotion = {
      schema_version: 1,
      issue_id: issueId,
      promoted_from_attempt_id: selectedAttemptId,
      promoted_at: now,
      execution_workspace_path: workspace.path,
      promotion_kind: "artifact-only",
    };
    writeJson(join(workDir, "promotion.json"), promotion);
    writeJson(join(workDir, "status.json"), {
      ...workStatus,
      promoted_from_attempt_id: selectedAttemptId,
      promoted_at: now,
      execution_workspace_path: workspace.path,
      promotion_kind: "artifact-only",
    });
    printBlock("attempt-promotion", {
      status: "promoted",
      issue: workItemText(workStatus.issue),
      attempt: selectedAttemptId,
      mode: "artifact-only",
      "execution-workspace": workspace.path,
      promotion: relativeToCwd(join(workDir, "promotion.json")),
      evidence: existsSync(targetEvidenceDir) ? relativeToCwd(targetEvidenceDir) : "missing",
      "next-step": `cd ${workspace.path} && slopflow review ${issueId}`,
    });
    return 0;
  });
}


export function readAttemptContext(issueId: string): { root: string; workDir: string; attemptsRoot: string; workStatus: WorkStatus } {
  const executionRoot = findRepoRoot(process.cwd());
  if (!executionRoot) {
    throw new SlopflowError("Could not find a repository root.", "Run Slopflow inside an initialized repository.", 2);
  }
  const pointer = readAttemptPointer(executionRoot);
  const root = pointer?.canonical_repository ?? executionRoot;
  const config = readMachineConfig(root);
  const workDir = resolveWorkDir(root, config, issueId);
  const workStatus = readWorkStatus(workDir, issueId, "attempt");
  return { root, workDir, attemptsRoot: join(workDir, "attempts"), workStatus };
}


export function parseIssueIdArg(issueId: string | undefined, usage: string): string {
  if (!issueId) {
    throw new SlopflowError("Missing issue id.", `Run \`${usage}\`.`, 2);
  }
  assertSafeWorkKey(issueId);
  return issueId;
}


export function parseAttemptIdArg(attemptId: string | undefined, usage: string): string {
  if (!attemptId) {
    throw new SlopflowError("Missing attempt id.", `Run \`${usage}\`.`, 2);
  }
  if (!/^a[1-9]\d*$/.test(attemptId)) {
    throw new SlopflowError("Attempt id must use the issue-local form a<number>.", "Use attempt ids such as a1, a2, or a3.", 2);
  }
  return attemptId;
}


export function parseAttemptCount(args: string[]): number {
  const countIndex = args.indexOf("--count");
  if (countIndex === -1) return 1;
  const raw = args[countIndex + 1];
  const count = Number(raw);
  if (!raw || !Number.isInteger(count) || count < 1) {
    throw new SlopflowError("Invalid attempt count.", "Use `--count <positive-integer>`.", 2);
  }
  return count;
}


export function createAttemptWorkspace({ root, config, issueId, attemptId }: { root: string; config: MachineConfig; issueId: string; attemptId: string }): AttemptWorkspace {
  const workspacePath = attemptWorkspacePath(root, config, issueId, attemptId);
  const createdAt = new Date().toISOString();
  if (existsSync(workspacePath)) {
    throw new SlopflowError(
      `Attempt workspace already exists: ${workspacePath}`,
      "Remove the stale workspace or choose a new attempt id before retrying.",
      2,
      { workspace: workspacePath, "next-step": "inspect or remove stale workspace path" },
    );
  }
  mkdirSync(dirname(workspacePath), { recursive: true });
  if (config.vcs.type === "jj") {
    const workspaceName = `slopflow-${issueId}-${attemptId}`;
    const result = spawnSync("jj", ["workspace", "add", "--name", workspaceName, workspacePath], { cwd: root, encoding: "utf8" });
    if (result.status !== 0 || result.error) {
      rmSync(workspacePath, { recursive: true, force: true });
      throw new SlopflowError(
        "Could not create Jujutsu attempt workspace.",
        "Inspect jj workspace add output and retry.",
        2,
        {
          workspace: workspacePath,
          command: `jj workspace add --name ${workspaceName} ${workspacePath}`,
          detail: summarizeText(result.stderr || result.stdout || result.error?.message || "jj workspace add failed"),
          "next-step": "fix Jujutsu workspace creation and retry",
        },
      );
    }
    return { schema_version: 1, kind: "jj-workspace", path: workspacePath, workspace_name: workspaceName, created_at: createdAt };
  }
  if (config.vcs.type === "git") {
    const branch = `slopflow/${issueId}/${attemptId}`;
    const result = spawnSync("git", ["worktree", "add", "-b", branch, workspacePath, "HEAD"], { cwd: root, encoding: "utf8" });
    if (result.status !== 0 || result.error) {
      rmSync(workspacePath, { recursive: true, force: true });
      throw new SlopflowError(
        "Could not create Git attempt worktree.",
        "Inspect git worktree output and retry.",
        2,
        {
          workspace: workspacePath,
          command: `git worktree add -b ${branch} ${workspacePath} HEAD`,
          detail: summarizeText(result.stderr || result.stdout || result.error?.message || "git worktree add failed"),
          "next-step": "fix Git worktree creation and retry",
        },
      );
    }
    return { schema_version: 1, kind: "git-worktree", path: workspacePath, branch, base_ref: "HEAD", created_at: createdAt };
  }
  throw new SlopflowError(
    `Unsupported version-control type for attempt workspaces: ${config.vcs.type}.`,
    "Configure vcs.type as jj or git before creating attempts.",
    2,
    { vcs: config.vcs.type, "next-step": "configure supported VCS or skip parallel attempts" },
  );
}


export function attemptWorkspacePath(root: string, config: MachineConfig, issueId: string, attemptId: string): string {
  const configuredRoot = config.workspace_root;
  const workspaceRoot = configuredRoot
    ? resolve(dirname(root), configuredRoot)
    : join(dirname(root), ".slopflow-workspaces", basenameSafe(root));
  return join(workspaceRoot, basenameSafe(root), issueId, attemptId);
}


export function basenameSafe(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) || "repository";
}


export function writeAttemptWorkspacePointer({ workspacePath, canonicalRepository, issueId, attemptId }: { workspacePath: string; canonicalRepository: string; issueId: string; attemptId: string }): void {
  writeJson(join(workspacePath, ".slopflow-attempt.json"), {
    schema_version: 1,
    canonical_repository: canonicalRepository,
    issue_id: issueId,
    attempt_id: attemptId,
  });
}


export function readAttemptPointer(root: string): AttemptWorkspacePointer | null {
  const pointerPath = join(root, ".slopflow-attempt.json");
  if (!existsSync(pointerPath)) return null;
  const pointer = readJson(pointerPath) as Partial<AttemptWorkspacePointer>;
  if (pointer.schema_version !== 1 || !pointer.canonical_repository || !pointer.issue_id || !pointer.attempt_id) {
    throw new SlopflowError(`Invalid attempt workspace pointer: ${relativeToCwd(pointerPath)}.`, "Inspect .slopflow-attempt.json before retrying.", 2);
  }
  return pointer as AttemptWorkspacePointer;
}


export function nextAttemptId(attemptsRoot: string): string {
  const numbers = readdirSyncSafe(attemptsRoot)
    .map((entry) => entry.match(/^a([1-9]\d*)$/)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => Number(value));
  const next = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  return `a${next}`;
}


export function listAttempts(attemptsRoot: string): AgentAttempt[] {
  return readdirSyncSafe(attemptsRoot)
    .filter((entry) => /^a[1-9]\d*$/.test(entry) && existsSync(join(attemptsRoot, entry, "attempt.json")))
    .map((entry) => readAttemptOrThrow(attemptsRoot, entry))
    .sort((left, right) => Number(left.attempt_id.slice(1)) - Number(right.attempt_id.slice(1)));
}


export function readAttemptOrThrow(attemptsRoot: string, attemptId: string): AgentAttempt {
  parseAttemptIdArg(attemptId, "slopflow attempt status <issue-id> <attempt-id>");
  const path = join(attemptsRoot, attemptId, "attempt.json");
  if (!existsSync(path)) {
    throw new SlopflowError(`Agent attempt not found: ${attemptId}.`, "Run `slopflow attempt list <issue-id>`.", 2);
  }
  return validateAgentAttempt(readJson(path), path);
}


export function validateAgentAttempt(value: unknown, path: string): AgentAttempt {
  const attempt = value as Partial<AgentAttempt>;
  if (attempt.schema_version !== 1 || !attempt.issue_id || !attempt.attempt_id || !attempt.status) {
    throw new SlopflowError(`Invalid agent attempt artifact: ${relativeToCwd(path)}.`, "Inspect attempt.json before retrying.", 2);
  }
  if (!["created", "active", "submitted", "selected", "rejected", "abandoned"].includes(attempt.status)) {
    throw new SlopflowError(`Invalid agent attempt status in ${relativeToCwd(path)}.`, "Use created, active, submitted, selected, rejected, or abandoned.", 2);
  }
  return attempt as AgentAttempt;
}


export function nextStepForAttempt(issueId: string, attempt: AgentAttempt, attemptDir: string): string {
  if (attempt.status === "created" || attempt.status === "active") {
    return existsSync(join(attemptDir, "summary.md")) ? `slopflow attempt submit ${issueId} ${attempt.attempt_id}` : `write ${relativeToCwd(join(attemptDir, "summary.md"))}`;
  }
  if (attempt.status === "submitted") return `slopflow attempt list ${issueId}`;
  if (attempt.status === "abandoned") return `inspect ${relativeToCwd(join(attemptDir, "abandon-note.md"))}`;
  if (attempt.status === "selected") return `slopflow attempt list ${issueId}`;
  return `slopflow attempt list ${issueId}`;
}


export function buildAttemptGoalPrompt(issue: WorkItemReference, attemptId: string, workspacePath?: string): string {
  return `You are working on ${workItemText(issue)}, agent attempt ${attemptId}.\n\n` +
    `${workspacePath ? `Use execution workspace:\n\n\`${workspacePath}\`\n\n` : ""}` +
    `Read the canonical issue execution contract before editing.\n\n` +
    `Do not edit other attempts or fabricate Slopflow artifacts.\n\n` +
    `Before submitting, write \`summary.md\` in this attempt directory.\n\n` +
    `When ready, run:\n\n` +
    `\`\`\`bash\nslopflow attempt submit ${issue.id ?? issue.number} ${attemptId}\n\`\`\`\n`;
}


export function buildAttemptAbandonNote(issue: WorkItemReference, attemptId: string, reason: string, timestamp: string): string {
  return `# Attempt Abandon Note\n\n` +
    `Work item: ${workItemText(issue)}\n\n` +
    `Attempt: ${attemptId}\n\n` +
    `Abandoned at: ${timestamp}\n\n` +
    `## Reason\n\n${reason}\n`;
}


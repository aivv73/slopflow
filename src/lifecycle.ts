import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { assertSafeWorkKey, findRepoRoot, issueWorkLockPath, parseReasonArg, printBlock, readCurrentJjChange, readCurrentVcsState, readMachineConfig, readWorkStatus, relativeToCwd, resolveWorkDir, withArtifactLock, writeJson } from "./infra.js";
import { issueText } from "./issue-model.js";
import { nextStepForWork, summarizeLatestTests, summarizeReviewVerdict } from "./quality-artifacts.js";
import type { WorkStatus } from "./types.js";
import { SlopflowError } from "./types.js";

export function lifecycleCommand(action: "pause" | "resume" | "cancel", args: string[]): number {
  const issueId = args[0];
  const force = args.includes("--force");
  const reason = action === "resume" ? undefined : parseReasonArg(args.slice(1), action);
  const { root, workDir, workStatus, statusPath } = readLifecycleContext(issueId, action);
  const issue = workStatus.issue;
  const issueTextValue = issueText(issue);
  const now = new Date().toISOString();

  return withArtifactLock({ scope: "work", lockPath: issueWorkLockPath(workDir), force, command: `slopflow ${action}` }, () => {

  if (action === "pause") {
    if (workStatus.status === "cancelled") {
      throw new SlopflowError("Cancelled issue work cannot be paused.", `Inspect ${relativeToCwd(join(workDir, "cancel-note.md"))}.`, 2);
    }
    if (workStatus.status === "complete") {
      throw new SlopflowError("Complete issue work cannot be paused.", `Inspect ${relativeToCwd(join(workDir, "completion-note.md"))}.`, 2);
    }
    const pauseNotePath = join(workDir, "pause-note.md");
    writeFileSync(pauseNotePath, buildLifecycleNote("Pause", issueTextValue, reason!, now), "utf8");
    writeJson(statusPath, { ...workStatus, status: "paused", paused_at: now, pause_reason: reason });
    printBlock("pause", {
      status: "paused",
      issue: issueTextValue,
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
    writeFileSync(cancelNotePath, buildLifecycleNote("Cancel", issueTextValue, reason!, now), "utf8");
    writeJson(statusPath, { ...workStatus, status: "cancelled", cancelled_at: now, cancel_reason: reason });
    printBlock("cancel", {
      status: "cancelled",
      issue: issueTextValue,
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
  const config = readMachineConfig(root);
  printBlock("resume", {
    status: wasPaused ? "active" : String(workStatus.status ?? "active"),
    issue: issueTextValue,
    contract: relativeToCwd(join(workDir, "contract.md")),
    tests: testsSummary,
    review: reviewStatus,
    completion: completionStatus,
    "current-vcs-state": readCurrentVcsState(root, config.vcs.type),
    ...(config.vcs.type === "jj" ? { "current-jj-change": readCurrentJjChange(root) } : {}),
    "next-step": nextStepForWork(issueId!, workDir, reviewStatus, completionStatus),
  });
  return 0;
  });
}


export function readLifecycleContext(issueId: string | undefined, command: "pause" | "resume" | "cancel"): { root: string; workDir: string; workStatus: WorkStatus; statusPath: string } {
  if (!issueId) {
    throw new SlopflowError("Missing issue id.", `Run \`slopflow ${command} <issue-id>${command === "resume" ? "" : " --reason <text>"}\`.`, 2);
  }
  assertSafeWorkKey(issueId);
  const root = findRepoRoot(process.cwd());
  if (!root) {
    throw new SlopflowError("Could not find a repository root.", "Run Slopflow inside an initialized repository.", 2);
  }
  const config = readMachineConfig(root);
  const workDir = resolveWorkDir(root, config, issueId);
  const statusPath = join(workDir, "status.json");
  return { root, workDir, statusPath, workStatus: readWorkStatus(workDir, issueId, command) };
}


export function buildLifecycleNote(kind: "Pause" | "Cancel", issue: string, reason: string, timestamp: string): string {
  const verb = kind === "Pause" ? "Paused" : "Cancelled";
  return `# ${kind} Note\n\n` +
    `Issue: ${issue}\n\n` +
    `${verb} at: ${timestamp}\n\n` +
    `## Reason\n\n${reason}\n`;
}


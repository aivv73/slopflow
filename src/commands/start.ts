import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { findRepoRoot, issueWorkLockPath, printBlock, readJson, readMachineConfig, readdirSyncSafe, relativeToCwd, withArtifactLock } from "../infra.js";
import { readTrackedItem } from "../issue-intake.js";
import { buildWorkKey, issueText, normalizeIssueReference, parseStartReference, stableStringify } from "../issue-model.js";
import { buildStartArtifacts } from "../start-artifacts.js";
import type { IssueReference } from "../types.js";
import { SlopflowError } from "../types.js";

export function startCommand(args: string[]): number {
  const force = args.includes("--force");
  const root = findRepoRoot(process.cwd());
  if (!root) {
    throw new SlopflowError(
      "Could not find a repository root.",
      "Run Slopflow inside an initialized repository.",
      2,
    );
  }
  const config = readMachineConfig(root);
  const reference = parseStartReference(args, config);
  if (reference.kind !== "issue") {
    throw new SlopflowError(
      `Unsupported tracked item kind: ${reference.kind}.`,
      "Issue intake currently supports kind=issue.",
      2,
    );
  }

  const item = readTrackedItem(reference);
  const workKey = buildWorkKey(item.ref);
  const workDir = join(root, config.artifact_root, workKey);
  const statusPath = join(workDir, "status.json");
  const workDirExisted = existsSync(workDir);

  mkdirSync(workDir, { recursive: true });
  return withArtifactLock({ scope: "work", lockPath: issueWorkLockPath(workDir), force, command: "slopflow start" }, () => {
    let action = "created";
    if (existsSync(statusPath)) {
      const existing = readJson(statusPath) as { issue?: IssueReference };
      if (stableStringify(normalizeIssueReference(existing.issue)) !== stableStringify(item.ref)) {
        throw new SlopflowError(
          `Work directory already exists for a different issue reference: ${relativeToCwd(workDir)}`,
          "Slopflow will not overwrite issue work automatically.",
          2,
        );
      }
      action = "unchanged";
    } else if (workDirExisted && (!force || readdirSyncSafe(workDir).some((entry) => entry !== "locks"))) {
      throw new SlopflowError(
        `Work directory already exists without status metadata: ${relativeToCwd(workDir)}`,
        "Move it aside or inspect it before retrying.",
        2,
      );
    } else {
      const artifacts = buildStartArtifacts({ item, workKey, workDir, root });
      for (const [filename, content] of Object.entries(artifacts)) {
        writeFileSync(join(workDir, filename), content, "utf8");
      }
    }

    printBlock("start", {
      status: action,
      issue: issueText(item.ref),
      kind: item.ref.kind,
      "work-key": workKey,
      "work-directory": relativeToCwd(workDir),
      contract: relativeToCwd(join(workDir, "contract.md")),
      "goal-prompt": relativeToCwd(join(workDir, "goal-prompt.md")),
      "next-step": `create goal mirror from ${relativeToCwd(join(workDir, "goal-prompt.md"))}`,
    });
    return 0;
  });
}


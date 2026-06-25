import { stableStringify } from "../issue-model.js";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

import { nodeVersionSatisfies, readPackageNodeEngine } from "../harness-install.js";
import { commandExists, countAgentAttempts, countWorkDirsByStatus, desiredConfig, detectVcsType, discoverRepoContext, findRepoRoot, printBlock, printJson, readCurrentJjChange, readCurrentVcsState, readJson, readMachineConfig, relativeToCwd, writeJson } from "../infra.js";
import { DEFAULT_ARTIFACT_ROOT } from "../types.js";
import { SlopflowError } from "../types.js";

export type DoctorCheck = {
  name: string;
  status: "passed" | "warn" | "failed";
  detail: string;
};


export function doctorCommand({ json = false }: { json?: boolean } = {}): number {
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

  checks.push({
    name: "core.repository",
    status: root ? "passed" : "failed",
    detail: root ? `root ${relativeToCwd(root)}` : "no .jj or .git repository root found",
  });

  const jjPresent = commandExists("jj");
  const gitPresent = commandExists("git");
  const jjRepo = root ? existsSync(join(root, ".jj")) : false;
  const gitRepo = root ? existsSync(join(root, ".git")) : false;
  const detectedVcs = root ? detectVcsType(root) : null;
  const vcsToolPresent = detectedVcs === "jj" ? jjPresent : detectedVcs === "git" ? gitPresent : false;
  checks.push({
    name: "core.vcs-repo",
    status: jjRepo || gitRepo ? "passed" : "failed",
    detail: jjRepo ? "Jujutsu repository detected" : gitRepo ? "Git repository detected" : "no Jujutsu or Git repository detected",
  });
  checks.push({
    name: "core.vcs-tool",
    status: vcsToolPresent ? "passed" : "failed",
    detail: detectedVcs === "jj"
      ? (jjPresent ? "jj executable found" : "jj executable missing")
      : detectedVcs === "git"
        ? (gitPresent ? "git executable found" : "git executable missing")
        : "no supported VCS tool selected",
  });
  checks.push({
    name: "recommended.jj",
    status: jjPresent ? "passed" : "warn",
    detail: jjPresent ? "jj executable found" : "jj executable missing; Git is supported, but Jujutsu is recommended",
  });

  const configPath = root ? join(root, ".slopflow", "config.json") : "";
  const configExists = Boolean(root && existsSync(configPath));
  checks.push({
    name: "core.config",
    status: configExists ? "passed" : "failed",
    detail: configExists ? relativeToCwd(configPath) : ".slopflow/config.json missing",
  });

  let artifactRoot = DEFAULT_ARTIFACT_ROOT;
  let configuredProvider = "";
  if (root && configExists) {
    try {
      const config = readMachineConfig(root);
      artifactRoot = config.artifact_root;
      configuredProvider = config.issue_tracker.provider;
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

  if (configuredProvider === "github") {
    const ghPresent = commandExists("gh");
    checks.push({
      name: "recommended.gh",
      status: ghPresent ? "passed" : "warn",
      detail: doctorDetail(ghPresent ? "gh executable found" : "gh executable missing; GitHub issue intake may fail"),
    });
    const ghAxiPresent = commandExists("gh-axi");
    checks.push({
      name: "recommended.gh-axi",
      status: ghAxiPresent ? "passed" : "warn",
      detail: doctorDetail(ghAxiPresent ? "gh-axi executable found" : "unchecked; run npx -y gh-axi --help when GitHub AXI operations are needed"),
    });
  } else if (configuredProvider === "gitlab") {
    const glabPresent = commandExists("glab");
    checks.push({
      name: "recommended.glab",
      status: glabPresent ? "passed" : "warn",
      detail: doctorDetail(glabPresent ? "glab executable found" : "glab executable missing; GitLab issue intake may fail"),
    });
  } else if (configuredProvider) {
    checks.push({
      name: `recommended.${configuredProvider}`,
      status: "warn",
      detail: doctorDetail(`unsupported issue tracker provider: ${configuredProvider}`),
    });
  }
  const failedCount = checks.filter((check) => check.status === "failed").length;
  const warningCount = checks.filter((check) => check.status === "warn").length;
  const status = failedCount > 0 ? "failed" : warningCount > 0 ? "warn" : "passed";
  const coreStatus = checks.some((check) => check.name.startsWith("core.") && check.status === "failed") ? "failed" : "passed";
  const projectDocsStatus = groupStatus(checks, "project-docs.");
  const recommendedStatus = groupStatus(checks, "recommended.");

  const doctor = {
    status,
    core: coreStatus,
    "project-docs": projectDocsStatus,
    recommended: recommendedStatus,
    "failed-count": failedCount,
    "warning-count": warningCount,
    "next-step": nextStepForDoctor(status, checks),
  };
  const checksOutput = Object.fromEntries(checks.map((check) => [check.name, `${check.status} ${check.detail}`]));
  if (json) {
    printJson({ doctor, checks: checksOutput });
  } else {
    printBlock("doctor", doctor);
    printBlock(`checks[${checks.length}]`, checksOutput);
  }
  return failedCount > 0 ? 2 : 0;
}


export function groupStatus(checks: DoctorCheck[], prefix: string): "passed" | "warn" | "failed" {
  const group = checks.filter((check) => check.name.startsWith(prefix));
  if (group.some((check) => check.status === "failed")) return "failed";
  if (group.some((check) => check.status === "warn")) return "warn";
  return "passed";
}


export function nextStepForDoctor(status: string, checks: DoctorCheck[]): string {
  if (status === "passed") return "slopflow start <provider-native-id>";
  const firstFailed = checks.find((check) => check.status === "failed");
  if (firstFailed?.name === "core.config") return "slopflow init";
  if (firstFailed?.name === "core.work-root") return "slopflow init";
  if (firstFailed?.name === "core.vcs-tool") return "install the configured VCS tool";
  if (firstFailed?.name === "core.repository" || firstFailed?.name === "core.vcs-repo") return "run inside a Jujutsu or Git repository";
  const firstWarn = checks.find((check) => check.status === "warn");
  if (firstWarn?.name === "recommended.jj") return "install jj when you want the recommended Slopflow workflow, or continue with Git";
  if (firstWarn?.name === "recommended.gh") return "install gh or continue if GitHub issue intake is not needed";
  if (firstWarn?.name === "recommended.gh-axi") return "run npx -y gh-axi --help when GitHub AXI operations are needed";
  if (firstWarn?.name === "recommended.glab") return "install glab or continue if GitLab issue intake is not needed";
  return "inspect doctor checks";
}


export function doctorDetail(value: string, limit = 160): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}


export async function homeCommand(): Promise<number> {
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
      vcs: detectVcsType(root) ?? "unknown",
      "next-step": "slopflow init",
    });
    return 0;
  }

  const config = readMachineConfig(root);
  const artifactRoot = String(config.artifact_root ?? DEFAULT_ARTIFACT_ROOT);
  const workRoot = join(root, artifactRoot);
  const workCounts = await countWorkDirsByStatus(workRoot);
  const attemptCount = await countAgentAttempts(workRoot);

  printBlock("slopflow", {
    bin,
    description,
    state: "initialized",
    repo: config.issue_tracker.repository,
    issue_tracker: config.issue_tracker.provider,
    vcs: config.vcs.type,
    "artifact-root": artifactRoot,
    "current-vcs-state": readCurrentVcsState(root, config.vcs.type),
    ...(config.vcs.type === "jj" ? { "current-jj-change": readCurrentJjChange(root) } : {}),
    "active-work-count": workCounts.active,
    "paused-work-count": workCounts.paused,
    "cancelled-work-count": workCounts.cancelled,
    "complete-work-count": workCounts.complete,
    "attempt-count": attemptCount,
    "next-step": "slopflow start <provider-native-id>",
  });
  return 0;
}


export function initCommand({ force }: { force: boolean }): number {
  const repo = discoverRepoContext(process.cwd());
  const configPath = join(repo.root, ".slopflow", "config.json");
  const workPath = join(repo.root, DEFAULT_ARTIFACT_ROOT);
  const desired = desiredConfig(repo.githubRepo, repo.vcs);

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
    vcs: repo.vcs,
    recommendation: repo.vcs === "git" ? "Jujutsu (jj) is recommended for the smoothest Slopflow workflow; Git is supported." : "Jujutsu (jj) is the recommended Slopflow workflow.",
    config: relativeToCwd(configPath),
    "artifact-root": desired.artifact_root,
    "next-step": "slopflow status",
  });
  return 0;
}


export async function statusCommand({ json = false }: { json?: boolean } = {}): Promise<number> {
  const root = findRepoRoot(process.cwd());
  if (!root) {
    throw new SlopflowError(
      "Could not find a repository root.",
      "Run Slopflow inside a Jujutsu or Git repository.",
      2,
    );
  }

  const config = readMachineConfig(root);
  const artifactRoot = String(config.artifact_root ?? DEFAULT_ARTIFACT_ROOT);
  const workRoot = join(root, artifactRoot);
  const workCounts = await countWorkDirsByStatus(workRoot);
  const attemptCount = await countAgentAttempts(workRoot);
  const currentVcsState = readCurrentVcsState(root, config.vcs.type);

  const status = {
    state: "initialized",
    repo: config.issue_tracker.repository,
    issue_tracker: config.issue_tracker.provider,
    vcs: config.vcs.type,
    "artifact-root": artifactRoot,
    "current-vcs-state": currentVcsState,
    ...(config.vcs.type === "jj" ? { "current-jj-change": readCurrentJjChange(root) } : {}),
    "active-work-count": workCounts.active,
    "paused-work-count": workCounts.paused,
    "cancelled-work-count": workCounts.cancelled,
    "complete-work-count": workCounts.complete,
    "attempt-count": attemptCount,
    "next-step": "slopflow start <provider-native-id>",
  };
  if (json) printJson({ status });
  else printBlock("status", status);
  return 0;
}


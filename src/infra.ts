import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { defaultBaseUrl, normalizeBaseUrl, normalizeIssueReference } from "./issue-model.js";
import type { ArtifactLockScope, IssueReference, MachineConfig, SupportedVcs, TestEvidence, WorkStatus } from "./types.js";
import { DEFAULT_ARTIFACT_ROOT, DEFAULT_PRS_AS_REQUEST_SURFACE, SCHEMA_VERSION } from "./types.js";
import { SlopflowError } from "./types.js";

export function resolveWorkDir(root: string, config: MachineConfig, issueId: string): string {
  assertSafeWorkKey(issueId);
  const direct = join(root, config.artifact_root, issueId);
  if (existsSync(direct)) return direct;
  const workRoot = join(root, config.artifact_root);
  const matches: string[] = [];
  for (const entry of readdirSyncSafe(workRoot)) {
    const candidate = join(workRoot, entry);
    const statusPath = join(candidate, "status.json");
    if (!existsSync(statusPath)) continue;
    try {
      const status = readJson(statusPath) as { issue?: IssueReference; work_key?: string };
      const issue = normalizeIssueReference(status.issue);
      if (status.work_key === issueId) return candidate;
      if (issue.id === issueId || issue.number === Number(issueId)) matches.push(candidate);
    } catch {
      continue;
    }
  }
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new SlopflowError(
      `Issue id ${issueId} matches multiple work directories.`,
      "Use the full Slopflow work key instead.",
      2,
    );
  }
  return direct;
}


export function assertSafeWorkKey(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new SlopflowError("Issue id or work key contains unsafe characters.", "Use a Slopflow work key or provider-native issue id.", 2);
  }
}


export function readWorkStatus(workDir: string, issueId: string, command: "test" | "review" | "complete" | "pause" | "resume" | "cancel" | "attempt"): WorkStatus {
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


export function workStatusCommandPhrase(command: "test" | "review" | "complete" | "pause" | "resume" | "cancel" | "attempt"): string {
  if (command === "test") return "capturing test evidence";
  if (command === "review") return "preparing review";
  if (command === "complete") return "completing work";
  if (command === "pause") return "pausing work";
  if (command === "resume") return "resuming work";
  if (command === "attempt") return "coordinating agent attempts";
  return "cancelling work";
}


export function readMachineConfig(root: string): MachineConfig {
  const configPath = join(root, ".slopflow", "config.json");
  if (!existsSync(configPath)) {
    throw new SlopflowError("Slopflow machine config is missing.", "Run `slopflow init` first.", 2);
  }
  const raw = readJson(configPath) as {
    schema_version?: number;
    artifact_root?: string;
    workspace_root?: string;
    issue_tracker?: {
      type?: string;
      provider?: string;
      repo?: string;
      repository?: string;
      base_url?: string;
      prs_as_request_surface?: boolean;
    };
    vcs?: { type?: string };
  };
  const provider = raw.issue_tracker?.provider ?? raw.issue_tracker?.type;
  const repository = raw.issue_tracker?.repository ?? raw.issue_tracker?.repo;
  if (!raw.artifact_root || !provider || !repository || !raw.vcs?.type) {
    throw new SlopflowError("Slopflow machine config is incomplete.", "Run `slopflow init --force` to refresh it.", 2);
  }
  return {
    schema_version: raw.schema_version ?? SCHEMA_VERSION,
    artifact_root: raw.artifact_root,
    ...(raw.workspace_root ? { workspace_root: raw.workspace_root } : {}),
    issue_tracker: {
      provider,
      repository,
      base_url: normalizeBaseUrl(raw.issue_tracker?.base_url ?? defaultBaseUrl(provider)),
      prs_as_request_surface: raw.issue_tracker?.prs_as_request_surface ?? DEFAULT_PRS_AS_REQUEST_SURFACE,
    },
    vcs: { type: raw.vcs.type },
  };
}


export function discoverRepoContext(start: string): { root: string; githubRepo: string; vcs: SupportedVcs } {
  const root = findRepoRoot(start);
  if (!root) {
    throw new SlopflowError(
      "Could not find a repository root.",
      "Run `slopflow init` inside a Jujutsu or Git repository with a GitHub origin remote.",
      2,
    );
  }
  const vcs = detectVcsType(root);
  if (!vcs) {
    throw new SlopflowError(
      "Supported VCS repository not detected.",
      "Initialize Jujutsu (recommended) or Git before running `slopflow init`.",
      2,
    );
  }
  if (vcs === "jj" && !commandExists("jj")) {
    throw new SlopflowError("Jujutsu executable not found.", "Install `jj` or use a Git repository without .jj metadata.", 2);
  }
  if (vcs === "git" && !commandExists("git")) {
    throw new SlopflowError("Git executable not found.", "Install `git` before running `slopflow init`.", 2);
  }
  return { root, githubRepo: readGithubRepo(root), vcs };
}


export function detectVcsType(root: string): SupportedVcs | null {
  if (existsSync(join(root, ".jj"))) return "jj";
  if (existsSync(join(root, ".git"))) return "git";
  return null;
}


export function findRepoRoot(start: string): string | null {
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


export function readGithubRepo(root: string): string {
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


export function gitConfigPath(root: string): string {
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


export function parseGithubRemote(url: string): string | null {
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


export function desiredConfig(githubRepo: string, vcs: SupportedVcs): MachineConfig {
  return {
    schema_version: SCHEMA_VERSION,
    artifact_root: DEFAULT_ARTIFACT_ROOT,
    workspace_root: ".slopflow-workspaces",
    issue_tracker: {
      provider: "github",
      repository: githubRepo,
      base_url: defaultBaseUrl("github"),
      prs_as_request_surface: DEFAULT_PRS_AS_REQUEST_SURFACE,
    },
    vcs: { type: vcs },
  };
}


export function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new SlopflowError(`Invalid JSON in ${path}.`, error.message, 2);
    }
    throw error;
  }
}


export function writeJson(path: string, data: unknown): void {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}



export async function countWorkDirsByStatus(workRoot: string): Promise<{ active: number; paused: number; cancelled: number; complete: number }> {
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


export async function countAgentAttempts(workRoot: string): Promise<number> {
  let count = 0;
  try {
    const workEntries = await readdir(workRoot, { withFileTypes: true });
    for (const workEntry of workEntries) {
      if (!workEntry.isDirectory()) continue;
      const attemptsRoot = join(workRoot, workEntry.name, "attempts");
      for (const attemptEntry of readdirSyncSafe(attemptsRoot)) {
        if (/^a[1-9]\d*$/.test(attemptEntry) && existsSync(join(attemptsRoot, attemptEntry, "attempt.json"))) count += 1;
      }
    }
  } catch {
    return count;
  }
  return count;
}


export function readCurrentJjChange(root: string): string {
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


export function readCurrentVcsState(root: string, vcs: string): string {
  if (vcs === "jj") return readCurrentJjChange(root);
  if (vcs === "git") {
    const branch = runTextCommand("git", ["branch", "--show-current"], root) || "detached HEAD";
    const status = runTextCommand("git", ["status", "--short"], root);
    const changed = status ? status.split("\n").filter(Boolean).length : 0;
    return `${branch}; ${changed} changed file${changed === 1 ? "" : "s"}`;
  }
  return "unsupported VCS";
}


export function readVcsStatus(root: string, vcs: string): string {
  if (vcs === "jj") return runTextCommand("jj", ["--no-pager", "status"], root);
  if (vcs === "git") return runTextCommand("git", ["status", "--short", "--branch"], root);
  return `unsupported VCS: ${vcs}`;
}


export function readVcsDiff(root: string, vcs: string): string {
  if (vcs === "jj") return runTextCommand("jj", ["--no-pager", "diff", "--git"], root);
  if (vcs === "git") return runTextCommand("git", ["diff", "--", "."], root);
  return `unsupported VCS: ${vcs}`;
}


export function isVcsStatusReadable(root: string, vcs: string): boolean {
  const command = vcs === "jj" ? "jj" : vcs === "git" ? "git" : "";
  const args = vcs === "jj" ? ["--no-pager", "status"] : vcs === "git" ? ["status", "--short"] : [];
  if (!command) return false;
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  return !result.error && result.status === 0;
}


export function vcsDisplayName(vcs: string): string {
  if (vcs === "jj") return "Jujutsu";
  if (vcs === "git") return "Git";
  return vcs;
}


export function commandExists(command: string): boolean {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  return !result.error && result.status === 0;
}


export function relativeToCwd(path: string): string {
  const relativePath = relative(process.cwd(), path);
  return relativePath.startsWith("..") ? path : relativePath || ".";
}


export function printBlock(name: string, values: Record<string, unknown>, stream: NodeJS.WritableStream = process.stdout): void {
  stream.write(`${name}:\n`);
  for (const [key, value] of Object.entries(values)) {
    stream.write(`  ${key}: ${String(value)}\n`);
  }
}


export function printJson(value: unknown, stream: NodeJS.WritableStream = process.stdout): void {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}


export function buildTestEvidenceSummary(testsPath: string): string {
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


export function runTextCommand(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.error) {
    return `unavailable: ${result.error.message}`;
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trimEnd();
}


export function boundText(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, limit), truncated: true };
}


export function changedFilesFromDiff(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split("\n")) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (match?.[2]) {
      files.add(match[2]);
    }
  }
  return [...files].sort();
}


export function withArtifactLock<T>({
  scope,
  lockPath,
  force,
  command,
}: {
  scope: ArtifactLockScope;
  lockPath: string;
  force: boolean;
  command: string;
}, action: () => T): T {
  acquireArtifactLock({ scope, lockPath, force, command });
  try {
    return action();
  } finally {
    releaseArtifactLock(lockPath);
  }
}


export function acquireArtifactLock({
  scope,
  lockPath,
  force,
  command,
}: {
  scope: ArtifactLockScope;
  lockPath: string;
  force: boolean;
  command: string;
}): void {
  if (existsSync(lockPath)) {
    if (!force) {
      const metadata = readLockMetadata(lockPath);
      throw new SlopflowError(
        `Slopflow artifact lock is held for ${scope} scope.`,
        `Inspect ${relativeToCwd(lockPath)} or rerun with --force if stale.`,
        2,
        {
          scope,
          lock: relativeToCwd(lockPath),
          ...(metadata.created_at ? { "held-since": metadata.created_at } : {}),
          "next-step": `inspect lock or rerun ${command} with --force if stale`,
        },
      );
    }
    rmSync(lockPath, { recursive: true, force: true });
  }
  mkdirSync(dirname(lockPath), { recursive: true });
  mkdirSync(lockPath, { recursive: false });
  writeJson(join(lockPath, "metadata.json"), {
    schema_version: 1,
    scope,
    command,
    pid: process.pid,
    cwd: process.cwd(),
    created_at: new Date().toISOString(),
  });
}


export function releaseArtifactLock(lockPath: string): void {
  rmSync(lockPath, { recursive: true, force: true });
}


export function readLockMetadata(lockPath: string): { created_at?: string } {
  const metadataPath = join(lockPath, "metadata.json");
  if (!existsSync(metadataPath)) return {};
  try {
    const metadata = readJson(metadataPath) as { created_at?: unknown };
    return typeof metadata.created_at === "string" ? { created_at: metadata.created_at } : {};
  } catch {
    return {};
  }
}


export function issueWorkLockPath(workDir: string): string {
  return join(workDir, "locks", "work.lock");
}


export function selectionLockPath(workDir: string): string {
  return join(workDir, "locks", "selection.lock");
}


export function attemptLockPath(attemptDir: string): string {
  return join(attemptDir, "attempt.lock");
}


export function parseReasonArg(args: string[], command: "pause" | "cancel" | "abandon" | "select"): string {
  const reasonIndex = args.indexOf("--reason");
  const reason = reasonIndex >= 0 ? args[reasonIndex + 1] : undefined;
  if (!reason || reason.trim().length === 0) {
    throw new SlopflowError("Missing required `--reason <text>`.", `Run \`slopflow ${command} <issue-id> --reason <text>\`.`, 2);
  }
  return reason.trim();
}


export function readdirSyncSafe(path: string): string[] {
  try {
    return existsSync(path) ? readdirSync(path) : [];
  } catch {
    return [];
  }
}



export function readTestEvidence(path: string): TestEvidence {
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

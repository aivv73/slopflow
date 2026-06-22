#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 1;
const DEFAULT_ARTIFACT_ROOT = ".slopflow/work";
const DEFAULT_PRS_AS_REQUEST_SURFACE = true;

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

class SlopflowError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
    readonly code = 1,
  ) {
    super(message);
  }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const [command, ...args] = argv;
    if (command === "init") {
      return initCommand({ force: args.includes("--force") });
    }
    if (command === "status") {
      return await statusCommand();
    }
    if (command === "start") {
      return startCommand(args[0]);
    }
    if (command === "test") {
      return testCommand(args);
    }
    printHelp();
    return 0;
  } catch (error) {
    if (error instanceof SlopflowError) {
      printBlock(
        "error",
        {
          status: "blocked",
          message: error.message,
          ...(error.hint ? { hint: error.hint } : {}),
        },
        process.stderr,
      );
      return error.code;
    }
    throw error;
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
  const workStatusPath = join(workDir, "status.json");
  if (!existsSync(workStatusPath)) {
    throw new SlopflowError(
      `Issue work status not found for #${issueId}.`,
      `Run \`slopflow start ${issueId}\` before capturing test evidence.`,
      2,
    );
  }

  const workStatus = readJson(workStatusPath) as { issue?: IssueReference };
  if (!workStatus.issue) {
    throw new SlopflowError(
      `Issue work status is missing issue metadata for #${issueId}.`,
      "Inspect the work directory before retrying.",
      2,
    );
  }

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
  const activeWorkCount = await countWorkDirs(workRoot);
  const currentJjChange = readCurrentJjChange(root);

  printBlock("status", {
    state: "initialized",
    repo: config.issue_tracker.repo,
    issue_tracker: config.issue_tracker.type,
    vcs: config.vcs.type,
    "artifact-root": artifactRoot,
    "current-jj-change": currentJjChange,
    "active-work-count": activeWorkCount,
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
  const issue = runGhJson(["issue", "view", String(number), "--repo", repo, "--json", "number,title,body,url,state"]);
  if (issue) {
    return normalizeGitHubItem(issue, "issue");
  }
  const pr = runGhJson(["pr", "view", String(number), "--repo", repo, "--json", "number,title,body,url,state"]);
  if (pr) {
    return normalizeGitHubItem(pr, "pull_request");
  }
  throw new SlopflowError(
    `Could not read GitHub issue or PR #${number} from ${repo}.`,
    "Ensure `gh` is installed, authenticated, and the item exists.",
    2,
  );
}

function runGhJson(args: string[]): unknown | null {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    return null;
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
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
    status: "started",
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

async function countWorkDirs(workRoot: string): Promise<number> {
  try {
    const entries = await readdir(workRoot, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).length;
  } catch {
    return 0;
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
    `Usage: slopflow <command>\n\nCommands:\n  init [--force]\n  status\n  start <issue-id>\n  test <issue-id> --name <gate> -- <command...>\n`,
  );
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main();
}

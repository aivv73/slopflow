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

  const configPath = join(root, ".slopflow", "config.json");
  if (!existsSync(configPath)) {
    throw new SlopflowError("Slopflow machine config is missing.", "Run `slopflow init` first.", 2);
  }

  const config = readJson(configPath) as Partial<MachineConfig>;
  const artifactRoot = String(config.artifact_root ?? DEFAULT_ARTIFACT_ROOT);
  const workRoot = join(root, artifactRoot);
  const activeWorkCount = await countWorkDirs(workRoot);
  const currentJjChange = readCurrentJjChange(root);

  printBlock("status", {
    state: "initialized",
    repo: config.issue_tracker?.repo ?? "unknown",
    issue_tracker: config.issue_tracker?.type ?? "unknown",
    vcs: config.vcs?.type ?? "unknown",
    "artifact-root": artifactRoot,
    "current-jj-change": currentJjChange,
    "active-work-count": activeWorkCount,
    "next-step": "slopflow start <issue-id>",
  });
  return 0;
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
  process.stdout.write(`Usage: slopflow <command>\n\nCommands:\n  init [--force]\n  status\n`);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main();
}

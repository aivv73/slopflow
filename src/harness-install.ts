import { createInterface } from "node:readline/promises";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { discoverRepoContext, findRepoRoot, printBlock, readJson, readdirSyncSafe, relativeToCwd } from "./infra.js";
import { SlopflowError } from "./types.js";

export type Harness = "pi" | "omp" | "claude-code" | "generic";


export type InstallArgs = {
  harness: Harness;
  yes: boolean;
  force: boolean;
};


export type InstallPackFile = {
  destination: string;
  content: string;
};


export type PlannedInstallFile = InstallPackFile & {
  action: "create" | "preserve" | "overwrite" | "conflict";
};


export async function installCommand(args: string[]): Promise<number> {
  const parsed = await parseInstallArgs(args);
  const repo = discoverRepoContext(process.cwd());
  const files = buildHarnessInstallPack(repo.root, parsed.harness);
  const plan = files.map((file): PlannedInstallFile => {
    if (!existsSync(file.destination)) return { ...file, action: "create" };
    const current = readFileSync(file.destination, "utf8");
    if (current === file.content) return { ...file, action: "preserve" };
    if (parsed.harness === "pi" && file.destination === join(repo.root, ".pi", "settings.json")) return { ...file, action: "overwrite" };
    return { ...file, action: parsed.force ? "overwrite" : "conflict" };
  });
  const conflict = plan.find((file) => file.action === "conflict");
  if (conflict) {
    throw new SlopflowError(
      "Existing harness workflow pack file differs from Slopflow pack.",
      `Inspect ${relativeToCwd(conflict.destination)} or rerun with \`slopflow install --harness ${parsed.harness} --yes --force\` to overwrite project-local pack files.`,
      2,
    );
  }

  const counts = countInstallActions(plan);
  const summary = harnessInstallSummary(parsed.harness, repo.root);
  if (!parsed.yes) {
    printBlock("install", {
      status: "planned",
      harness: parsed.harness,
      mode: "dry-run",
      ...summary,
      "file-count": plan.length,
      "create-count": counts.create,
      "preserve-count": counts.preserve,
      "overwrite-count": counts.overwrite,
      writes: "none",
      "next-step": `slopflow install --harness ${parsed.harness} --yes`,
    });
    return 0;
  }

  for (const file of plan) {
    if (file.action === "preserve") continue;
    mkdirSync(dirname(file.destination), { recursive: true });
    writeFileSync(file.destination, file.content, "utf8");
  }
  printBlock("install", {
    status: counts.create === 0 && counts.overwrite === 0 ? "unchanged" : "applied",
    harness: parsed.harness,
    mode: "apply",
    ...summary,
    "file-count": plan.length,
    "written-count": counts.create + counts.overwrite,
    "preserve-count": counts.preserve,
    "overwrite-count": counts.overwrite,
    writes: "project-local",
    "next-step": "slopflow doctor",
  });
  return 0;
}


export async function parseInstallArgs(args: string[]): Promise<InstallArgs> {
  if (args[0] === "minimal") {
    throw new SlopflowError(
      "`slopflow install minimal` has been replaced by `slopflow init`.",
      "Run `slopflow init` for minimal setup, or `slopflow install --harness pi|omp|claude-code|generic` for a harness workflow pack.",
      2,
    );
  }
  if (args[0] === "recommended") {
    throw new SlopflowError(
      "`slopflow install recommended` has been replaced by explicit harness workflow packs.",
      "Run `slopflow install --harness pi|omp|claude-code|generic`.",
      2,
    );
  }

  let harness: Harness | null = null;
  let yes = false;
  let force = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--yes") {
      yes = true;
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--harness") {
      const next = args[index + 1];
      if (!next) throw new SlopflowError("Missing harness value.", "Run `slopflow install --harness pi|omp|claude-code|generic`.", 2);
      harness = parseHarness(next);
      index += 1;
    } else if (arg?.startsWith("--harness=")) {
      harness = parseHarness(arg.slice("--harness=".length));
    } else if (arg) {
      throw new SlopflowError("Unsupported install argument.", "Run `slopflow install --harness pi|omp|claude-code|generic [--yes] [--force]`.", 2);
    }
  }
  if (!harness && process.stdin.isTTY && process.stdout.isTTY) {
    harness = await promptForHarness();
  }
  if (!harness) {
    throw new SlopflowError("Missing harness selection.", "Run `slopflow install --harness pi|omp|claude-code|generic`.", 2);
  }
  return { harness, yes, force };
}


export function parseHarness(value: string): Harness {
  if (value === "pi" || value === "omp" || value === "claude-code" || value === "generic") return value;
  throw new SlopflowError("Unsupported harness.", "Use one of: pi, omp, claude-code, generic.", 2);
}


export async function promptForHarness(): Promise<Harness> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question("Which agent harness do you use? [pi/omp/claude-code/generic] ")).trim().toLowerCase();
    if (answer === "1") return "pi";
    if (answer === "2") return "omp";
    if (answer === "3") return "claude-code";
    if (answer === "4" || answer === "other") return "generic";
    return parseHarness(answer);
  } finally {
    rl.close();
  }
}


export function buildHarnessInstallPack(root: string, harness: Harness): InstallPackFile[] {
  const files: InstallPackFile[] = [];
  if (harness === "pi") {
    files.push(...collectSkillPack("slopflow-live", join(root, ".pi", "skills", "slopflow-live")));
    files.push(...collectSkillPack("setup-slopflow-skills-live", join(root, ".pi", "skills", "setup-slopflow-skills-live")));
    files.push({ destination: join(root, ".pi", "settings.json"), content: piSettingsTemplate(root) });
    files.push({ destination: join(root, ".pi", "extensions", "slopflow", "index.ts"), content: piExtensionTemplate() });
    files.push({ destination: join(root, ".pi", "agents", "slopflow-planner.md"), content: piAgentRoleTemplate("planner") });
    files.push({ destination: join(root, ".pi", "agents", "slopflow-executor.md"), content: piAgentRoleTemplate("executor") });
    files.push({ destination: join(root, ".pi", "agents", "slopflow-reviewer.md"), content: piAgentRoleTemplate("reviewer") });
  } else if (harness === "omp") {
    files.push(...collectSkillPack("slopflow-live", join(root, ".omp", "skills", "slopflow-live")));
    files.push(...collectSkillPack("setup-slopflow-skills-live", join(root, ".omp", "skills", "setup-slopflow-skills-live")));
    files.push({ destination: join(root, ".omp", "commands", "slopflow-create-goal.md"), content: ompCreateGoalCommandTemplate() });
  } else if (harness === "claude-code") {
    files.push(...collectSkillPack("slopflow-live", join(root, ".claude", "skills", "slopflow-live")));
    files.push(...collectSkillPack("setup-slopflow-skills-live", join(root, ".claude", "skills", "setup-slopflow-skills-live")));
  } else {
    files.push(...collectSkillPack("slopflow", join(root, ".agents", "skills", "slopflow")));
    files.push(...collectSkillPack("setup-slopflow-skills", join(root, ".agents", "skills", "setup-slopflow-skills")));
  }
  return files.sort((left, right) => left.destination.localeCompare(right.destination));
}


export function collectSkillPack(skillName: string, destinationRoot: string): InstallPackFile[] {
  const sourceRoot = join(packageRoot(), "skills", skillName);
  if (!existsSync(sourceRoot)) {
    throw new SlopflowError(`Slopflow skill pack asset is missing: skills/${skillName}.`, "Reinstall the slopflow npm package or run from a complete source checkout.", 2);
  }
  const files: InstallPackFile[] = [];
  for (const path of listFilesRecursive(sourceRoot)) {
    files.push({
      destination: join(destinationRoot, relative(sourceRoot, path)),
      content: readFileSync(path, "utf8"),
    });
  }
  return files;
}


export function listFilesRecursive(root: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root).sort()) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      result.push(...listFilesRecursive(path));
    } else if (stat.isFile()) {
      result.push(path);
    }
  }
  return result;
}


export function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}


export function countInstallActions(plan: PlannedInstallFile[]): Record<"create" | "preserve" | "overwrite", number> {
  return {
    create: plan.filter((file) => file.action === "create").length,
    preserve: plan.filter((file) => file.action === "preserve").length,
    overwrite: plan.filter((file) => file.action === "overwrite").length,
  };
}


export function harnessInstallSummary(harness: Harness, root: string): Record<string, string> {
  if (harness === "pi") {
    return {
      skills: relativeToCwd(join(root, ".pi", "skills")),
      extensions: relativeToCwd(join(root, ".pi", "extensions")),
      agents: relativeToCwd(join(root, ".pi", "agents")),
      settings: relativeToCwd(join(root, ".pi", "settings.json")),
      packages: String(PI_RECOMMENDED_PACKAGES.length),
    };
  }
  if (harness === "omp") {
    return {
      skills: relativeToCwd(join(root, ".omp", "skills")),
      commands: relativeToCwd(join(root, ".omp", "commands")),
      "skill-interpolation": SKILL_INTERPOLATION_PACKAGE,
      "native-subagents": "task",
      "native-goal": "goal",
    };
  }
  if (harness === "claude-code") {
    return { skills: relativeToCwd(join(root, ".claude", "skills")), extensions: "not-supported", agents: "not-supported" };
  }
  return { skills: relativeToCwd(join(root, ".agents", "skills")), "live-skills": "skipped", extensions: "skipped", agents: "skipped" };
}


export const SKILL_INTERPOLATION_PACKAGE = "git:github.com/joelhooks/pi-skill-interpolation";


export const PI_RECOMMENDED_PACKAGES = [
  SKILL_INTERPOLATION_PACKAGE,
  "npm:@tintinweb/pi-subagents",
  "npm:pi-codex-goal",
];


export function piSettingsTemplate(root: string): string {
  const settingsPath = join(root, ".pi", "settings.json");
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    const existing = readJson(settingsPath);
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      throw new SlopflowError("Invalid .pi/settings.json shape.", "Expected a JSON object before merging Slopflow Pi packages.", 2);
    }
    settings = existing as Record<string, unknown>;
  }
  const existingPackages = Array.isArray(settings.packages) ? settings.packages.filter((value): value is string => typeof value === "string") : [];
  settings.packages = [...existingPackages, ...PI_RECOMMENDED_PACKAGES.filter((pkg) => !existingPackages.includes(pkg))];
  return `${JSON.stringify(settings, null, 2)}\n`;
}


export function piExtensionTemplate(): string {
  return `import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("slopflow-status", {
    description: "Show project Slopflow status",
    handler: async (_args, ctx) => {
      const result = await pi.exec("slopflow", ["status"], { timeout: 10_000 });
      const output = result.stdout || result.stderr || "slopflow status produced no output";
      ctx.ui.notify(output.trim(), result.code === 0 ? "info" : "warning");
    },
  });

  pi.registerCommand("slopflow-doctor", {
    description: "Run Slopflow doctor for this project",
    handler: async (_args, ctx) => {
      const result = await pi.exec("slopflow", ["doctor"], { timeout: 10_000 });
      const output = result.stdout || result.stderr || "slopflow doctor produced no output";
      ctx.ui.notify(output.trim(), result.code === 0 ? "info" : "warning");
    },
  });

  pi.registerCommand("slopflow-create-goal", {
    description: "Prepare a pi-codex-goal /create-goal prompt from a Slopflow issue",
    handler: async (args, ctx) => {
      const issueId = args.trim();
      if (!/^\\d+$/.test(issueId)) {
        ctx.ui.notify("Usage: /slopflow-create-goal <issue-id>", "warning");
        return;
      }
      const start = await pi.exec("slopflow", ["start", issueId], { timeout: 30_000 });
      if (start.code !== 0) {
        ctx.ui.notify((start.stdout || start.stderr || "slopflow start failed").trim(), "error");
        return;
      }
      const goalPrompt = start.stdout.match(/goal-prompt:\\s*(.+)/)?.[1]?.trim() ?? ".slopflow/work/" + issueId + "/goal-prompt.md";
      const absoluteGoalPrompt = resolve(ctx.cwd, goalPrompt);
      if (!existsSync(absoluteGoalPrompt)) {
        ctx.ui.notify("Slopflow goal prompt not found: " + goalPrompt, "error");
        return;
      }
      const prompt = readFileSync(absoluteGoalPrompt, "utf8").trim();
      ctx.ui.setEditorText("/create-goal " + prompt);
      ctx.ui.notify("Prepared /create-goal from " + goalPrompt + ". Review and submit when ready.", "info");
    },
  });
}
`;
}

export function ompCreateGoalCommandTemplate(): string {
  return `# Create a Slopflow goal mirror

## Arguments

- \`$ARGUMENTS\` — numeric issue id.

## Steps

1. Validate that \`$ARGUMENTS\` is a numeric issue id.
2. Run \`slopflow start <issue-id>\`.
3. Read the generated \`.slopflow/work/<issue-id>/goal-prompt.md\`.
4. Create an OMP native goal mirror from that prompt with \`/goal set <goal prompt content>\`.
5. Continue through the \`slopflow-live\` skill workflow.

Use OMP native primitives for this harness profile: \`task\` for subagents and \`/goal\` for goal mirrors. Skill shell interpolation requires \`${SKILL_INTERPOLATION_PACKAGE}\` to be installed in the active OMP/Pi environment. Do not install Codex-specific conversion, subagent, or goal adapter packages for OMP.
`;
}


export function piAgentRoleTemplate(role: "planner" | "executor" | "reviewer"): string {
  if (role === "planner") {
    return `---
description: Plan controlled Slopflow issue execution before code changes
tools: read, grep, find, bash, ls
skills: slopflow-live
thinking: medium
max_turns: 20
prompt_mode: replace
---

You are a Slopflow planning specialist.

Your job is to turn a GitHub issue or Slopflow work directory into a safe implementation plan.

Rules:

- Treat \`.slopflow/work/<issue-id>/\` artifacts as canonical.
- Do not edit files.
- Do not create commits, branches, PRs, or issues.
- Do not run mutating Slopflow lifecycle commands.
- Prefer read-only commands such as \`slopflow status\`, \`slopflow doctor\`, \`ls\`, \`grep\`, and file reads.
- Produce a concise implementation plan with scope, affected files, risks, test plan, and Slopflow lifecycle next step.
`;
  }
  if (role === "executor") {
    return `---
description: Execute Slopflow issue work while preserving evidence and lifecycle artifacts
tools: "*"
skills: slopflow-live
thinking: medium
max_turns: 50
prompt_mode: append
---

You are a Slopflow execution specialist.

Follow the parent project instructions and the Slopflow lifecycle strictly.

Required behavior:

- Use \`slopflow start <issue-id>\` before issue execution when no work directory exists.
- Use \`slopflow test <issue-id> --name <gate> -- <command...>\` to record test evidence.
- Do not manually fabricate test evidence, review verdicts, completion notes, or status metadata.
- Do not push, merge, publish, create a pull request, or close an issue unless explicitly requested.
- Before claiming done, ensure Slopflow evidence and review/completion requirements are satisfied.
`;
  }
  return `---
description: Review Slopflow work packets and verify completion gates
tools: read, grep, find, bash, ls
skills: slopflow-live
thinking: high
max_turns: 25
prompt_mode: replace
---

You are a Slopflow review specialist.

Review whether work is safe to call complete.

Rules:

- Treat \`.slopflow/work/<issue-id>/\` artifacts as canonical.
- Do not edit source files.
- Do not write review verdicts unless explicitly asked to produce a verdict artifact.
- Inspect test evidence, status metadata, completion notes, and relevant diffs.
- Verify that claimed changes match the issue contract.
- Report verdict recommendation, missing evidence, risks, required changes, and exact files or artifacts inspected.
`;
}


export type LintCheck = {
  name: string;
  status: "passed" | "failed";
  detail: string;
};


export function skillCommand(args: string[]): number {
  const [subcommand] = args;
  if (subcommand !== "lint") {
    throw new SlopflowError("Unsupported skill command.", "Run `slopflow skill lint`.", 2);
  }
  const root = findRepoRoot(process.cwd()) ?? process.cwd();
  const skillsDir = join(root, "skills");
  const checks = lintSkills(skillsDir);
  const failedCount = checks.filter((check) => check.status === "failed").length;
  printBlock("skill-lint", {
    status: failedCount > 0 ? "failed" : "passed",
    "skills-dir": relativeToCwd(skillsDir),
    "failed-count": failedCount,
    "check-count": checks.length,
    "next-step": failedCount > 0 ? "fix failing skill checks" : "no skill lint action required",
  });
  printBlock(`checks[${checks.length}]`, Object.fromEntries(checks.map((check) => [check.name, `${check.status} ${check.detail}`])));
  return failedCount > 0 ? 2 : 0;
}


export function lintSkills(skillsDir: string): LintCheck[] {
  const checks: LintCheck[] = [];
  const portablePath = join(skillsDir, "slopflow", "SKILL.md");
  const livePath = join(skillsDir, "slopflow-live", "SKILL.md");
  const portable = readOptionalText(portablePath);
  const live = readOptionalText(livePath);

  checks.push({ name: "slopflow.exists", status: portable ? "passed" : "failed", detail: portable ? "skills/slopflow/SKILL.md" : "missing skills/slopflow/SKILL.md" });
  if (portable) {
    checks.push({ name: "slopflow.no-interpolation", status: /!`/.test(portable) ? "failed" : "passed", detail: /!`/.test(portable) ? "portable skill contains shell interpolation" : "no shell interpolation" });
    checks.push(skillTextCheck("slopflow.canonical", portable, /artifacts are canonical/i, "states CLI/artifacts are canonical"));
    checks.push(skillTextCheck("slopflow.no-fabrication", portable, /Do not manually fabricate/i, "forbids fabricated artifacts"));
    checks.push(skillTextCheck("slopflow.no-push-without-request", portable, /Do not push, merge, publish, create a pull request, or close an issue unless/i, "forbids push/merge/publish/PR/close unless requested"));
  }

  checks.push({ name: "slopflow-live.exists", status: live ? "passed" : "failed", detail: live ? "skills/slopflow-live/SKILL.md" : "missing skills/slopflow-live/SKILL.md" });
  if (live) {
    checks.push({ name: "slopflow-live.read-only-interpolation", status: liveInterpolationIsReadOnly(live) ? "passed" : "failed", detail: liveInterpolationIsReadOnly(live) ? "interpolation commands look read-only" : "interpolation includes mutating command" });
    checks.push(skillTextCheck("slopflow-live.canonical", live, /artifacts are canonical/i, "states CLI/artifacts are canonical"));
    checks.push(skillTextCheck("slopflow-live.no-fabrication", live, /Do not manually fabricate/i, "forbids fabricated artifacts"));
    checks.push(skillTextCheck("slopflow-live.no-push-without-request", live, /Do not push, merge, publish, create a pull request, or close an issue unless/i, "forbids push/merge/publish/PR/close unless requested"));
  }

  for (const template of setupTemplateFiles(skillsDir)) {
    const relativePath = relative(skillsDir, template);
    const content = readOptionalText(template) ?? "";
    const ok = /^---\n[\s\S]+?\n---\n/.test(content) && /^type:\s*\S.+$/m.test(content.match(/^---\n([\s\S]+?)\n---\n/)?.[1] ?? "");
    checks.push({ name: `setup-template.${relativePath}`, status: ok ? "passed" : "failed", detail: ok ? "OKF frontmatter with type" : "missing OKF frontmatter type" });
  }
  return checks;
}


export function skillTextCheck(name: string, content: string, pattern: RegExp, passedDetail: string): LintCheck {
  return { name, status: pattern.test(content) ? "passed" : "failed", detail: pattern.test(content) ? passedDetail : `missing ${passedDetail}` };
}


export function liveInterpolationIsReadOnly(content: string): boolean {
  const commands = [...content.matchAll(/!`([^`]+)`/g)].map((match) => match[1] ?? "");
  return commands.every((command) => !/\b(slopflow\s+(init|start|test|review|complete|pause|resume|cancel)|jj\s+(new|desc|rebase|git\s+push)|gh\s+(issue|pr)\s+(create|edit|close|comment)|rm\s+-|write|curl\s+-X\s*(POST|PUT|PATCH|DELETE))\b/i.test(command));
}


export function setupTemplateFiles(skillsDir: string): string[] {
  const result: string[] = [];
  for (const setupName of ["setup-slopflow-skills", "setup-slopflow-skills-live"]) {
    const dir = join(skillsDir, setupName);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSyncSafe(dir)) {
      const path = join(dir, entry);
      if (entry === "SKILL.md" || !entry.endsWith(".md") || !statSync(path).isFile()) continue;
      result.push(path);
    }
  }
  return result.sort();
}


export function readOptionalText(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}


export function readPackageNodeEngine(root: string): string | null {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) return null;
  try {
    const packageJson = readJson(packagePath) as { engines?: { node?: unknown } };
    return typeof packageJson.engines?.node === "string" ? packageJson.engines.node : null;
  } catch {
    return null;
  }
}


export function nodeVersionSatisfies(version: string, engine: string): boolean {
  const major = Number(version.split(".")[0] ?? "0");
  const minimumMajor = engine.match(/>=\s*(\d+)/)?.[1];
  if (minimumMajor) return major >= Number(minimumMajor);
  return true;
}


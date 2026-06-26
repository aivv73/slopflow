
import { attemptCommand } from "./attempts.js";
import { doctorCommand, homeCommand, initCommand, statusCommand } from "./commands/core.js";
import { startCommand } from "./commands/start.js";
import { installCommand, skillCommand } from "./harness-install.js";
import { printBlock, printJson } from "./infra.js";
import { lifecycleCommand } from "./lifecycle.js";
import { completeCommand, reviewCommand, testCommand } from "./quality-artifacts.js";
import { SlopflowError } from "./types.js";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const wantsJson = argv.includes("--json");
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
      return await statusCommand({ json: args.includes("--json") });
    }
    if (command === "doctor") {
      return doctorCommand({ json: args.includes("--json") });
    }
    if (command === "install") {
      return await installCommand(args);
    }
    if (command === "skill") {
      return skillCommand(args);
    }
    if (command === "start") {
      return startCommand(args);
    }
    if (command === "attempt") {
      return attemptCommand(args);
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
      return reviewCommand(args);
    }
    if (command === "complete") {
      return completeCommand(args);
    }
    throw new SlopflowError(`Unknown command: ${command}`, "Run `slopflow --help`.", 2);
  } catch (error) {
    if (error instanceof SlopflowError) {
      const payload = {
        status: "blocked",
        message: error.message,
        ...error.details,
        ...(error.hint ? { hint: error.hint } : {}),
      };
      if (wantsJson) printJson({ error: payload });
      else printBlock("error", payload);
      return error.code;
    }
    throw error;
  }
}


export function printHelp(): void {
  process.stdout.write(
    `Usage: slopflow <command>\n\nCommands:\n  init [--force]\n  status\n  doctor\n  install --harness pi|omp|claude-code|generic [--yes] [--force]\n  start <issue-id>\n  attempt create <issue-id> [--count <n>]\n  attempt list <issue-id>\n  attempt status <issue-id> [attempt-id]\n  attempt submit <issue-id> <attempt-id>\n  attempt abandon <issue-id> <attempt-id> --reason <text>\n  attempt compare <issue-id>\n  attempt select <issue-id> <attempt-id> --reason <text>\n  attempt promote <issue-id>\n  pause <issue-id> --reason <text>\n  resume <issue-id>\n  cancel <issue-id> --reason <text>\n  test <issue-id> --name <gate> -- <command...>\n  test <issue-id> --attempt <attempt-id> --name <gate> -- <command...>\n  review <issue-id>\n  complete <issue-id>\n  skill <name>\n`,
  );
}


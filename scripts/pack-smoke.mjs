import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let tarballPath;
let tempDir;

try {
  const pack = run("npm", ["pack", "--json"], { cwd: repoRoot });
  const packed = JSON.parse(pack.stdout);
  const filename = packed?.[0]?.filename;
  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error(`Could not determine npm pack filename from output: ${pack.stdout}`);
  }
  tarballPath = join(repoRoot, filename);
  if (!existsSync(tarballPath)) {
    throw new Error(`Expected tarball to exist: ${tarballPath}`);
  }

  tempDir = mkdtempSync(join(tmpdir(), "slopflow-pack-smoke-"));
  writeFileSync(join(tempDir, "package.json"), "{\"private\":true}\n", "utf8");
  run("npm", ["install", "--silent", tarballPath], { cwd: tempDir });

  const help = run(installedBin(tempDir), ["--help"], { cwd: tempDir });
  for (const command of ["init", "status", "start", "pause", "resume", "cancel", "test", "review", "complete"]) {
    if (!help.stdout.includes(command)) {
      throw new Error(`Installed slopflow --help output did not include command: ${command}\n${help.stdout}`);
    }
  }

  console.log("pack-smoke:");
  console.log(`  status: passed`);
  console.log(`  tarball: ${filename}`);
  console.log(`  checked: slopflow --help`);
} finally {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
  if (tarballPath) {
    rmSync(tarballPath, { force: true });
  }
}

function installedBin(prefix) {
  return process.platform === "win32"
    ? join(prefix, "node_modules", ".bin", "slopflow.cmd")
    : join(prefix, "node_modules", ".bin", "slopflow");
}

function run(command, args, options) {
  const result = spawnSync(command, args, { ...options, encoding: "utf8" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result;
}

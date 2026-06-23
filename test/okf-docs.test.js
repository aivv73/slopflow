import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("docs/agents concept documents have OKF frontmatter with type", () => {
  const docsDir = join(process.cwd(), "docs", "agents");
  const conceptFiles = readdirSync(docsDir)
    .filter((file) => file.endsWith(".md"))
    .filter((file) => file !== "index.md");

  assert.ok(conceptFiles.length > 0, "expected docs/agents concept documents");

  for (const file of conceptFiles) {
    const path = join(docsDir, file);
    const content = readFileSync(path, "utf8");
    assert.match(content, /^---\n[\s\S]+?\n---\n/, `${file} must start with YAML frontmatter`);
    const frontmatter = content.match(/^---\n([\s\S]+?)\n---\n/)?.[1] ?? "";
    assert.match(frontmatter, /^type:\s*\S.+$/m, `${file} frontmatter must include non-empty type`);
  }
});

test("OKF index documents have frontmatter and relative links", () => {
  const indexes = [
    {
      path: join(process.cwd(), "docs", "agents", "index.md"),
      links: ["issue-tracker.md", "triage-labels.md", "domain.md"],
    },
    {
      path: join(process.cwd(), "docs", "adr", "index.md"),
      links: [
        "0001-slopflow-v0-is-a-cli-runbook.md",
        "0002-slopflow-cli-is-typescript-first.md",
        "0003-test-evidence-keeps-attempt-history.md",
        "0004-review-command-does-not-self-approve.md",
        "0005-complete-is-a-local-artifact-gate.md",
        "0006-skills-are-distributed-by-skills-installers.md",
        "0007-lifecycle-commands-are-artifact-state-transitions.md",
        "0008-cli-output-follows-axi-principles.md",
        "0009-agent-docs-use-okf-runtime-artifacts-remain-slopflow-artifacts.md",
      ],
    },
  ];

  for (const index of indexes) {
    const content = readFileSync(index.path, "utf8");
    assert.match(content, /^---\n[\s\S]+?\n---\n/, `${index.path} must start with YAML frontmatter`);
    const frontmatter = content.match(/^---\n([\s\S]+?)\n---\n/)?.[1] ?? "";
    assert.match(frontmatter, /^type:\s*Index$/m, `${index.path} frontmatter must declare type: Index`);
    for (const link of index.links) {
      assert.match(content, new RegExp(`\\(${link.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`), `${index.path} must link ${link}`);
    }
  }
});

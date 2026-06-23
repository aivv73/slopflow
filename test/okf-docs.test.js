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

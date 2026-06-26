import { relative } from "node:path";

import { buildTrackedItemContext, formatCommentsMarkdown, issueText } from "./issue-model.js";
import { escapeMarkdown, indentBlock } from "./quality-artifacts.js";
import type { IssueReference, TrackedItem } from "./types.js";

export function buildStartArtifacts({
  item,
  workKey,
  workDir,
  root,
}: {
  item: TrackedItem;
  workKey: string;
  workDir: string;
  root: string;
}): Record<string, string> {
  const contract = buildContract(item);
  const status = {
    schema_version: 1,
    status: "active",
    issue: item.ref,
    work_key: workKey,
    work_directory: relative(root, workDir),
    artifacts: {
      tracked_item: "tracked-item.json",
      issue: "issue.md",
      contract: "contract.md",
      goal_prompt: "goal-prompt.md",
      next_steps: "next-steps.md",
    },
    created_by: "slopflow start",
  };
  return {
    "tracked-item.json": `${JSON.stringify(buildTrackedItemSnapshot(item), null, 2)}\n`,
    "issue.md": buildIssueMarkdown(item),
    "contract.md": contract,
    "status.json": `${JSON.stringify(status, null, 2)}\n`,
    "goal-prompt.md": buildGoalPrompt(contract),
    "next-steps.md": buildNextSteps(item.ref),
  };
}


export function buildTrackedItemSnapshot(item: TrackedItem): Record<string, unknown> {
  return {
    schema_version: 1,
    fetched_at: new Date().toISOString(),
    ref: item.ref,
    title: item.title,
    description: item.description,
    comments: item.comments,
    labels: item.labels,
    state: item.state,
    url: item.url,
  };
}


export function buildIssueMarkdown(item: TrackedItem): string {
  return `# ${escapeMarkdown(item.title)}\n\n` +
    `Issue: ${issueText(item.ref)}\n\n` +
    `Kind: ${item.ref.kind}\n\n` +
    `State: ${item.state}\n\n` +
    `URL: ${item.url}\n\n` +
    `## Description\n\n${item.description || "_No issue description provided._"}\n\n` +
    `## Comments\n\n${formatCommentsMarkdown(item.comments)}`;
}


export function buildContract(item: TrackedItem): string {
  const providerContext = buildTrackedItemContext(item);
  return `# Issue Execution Contract\n\n` +
    `Issue: ${issueText(item.ref)}\n\n` +
    `## Issue Summary\n\n${item.title}\n\n` +
    `## Acceptance Criteria\n\nExtract from the source issue before implementing. Source tracked item context:\n\n${indentBlock(providerContext)}\n\n` +
    `## Constraints\n\n- Stay within the scope of ${issueText(item.ref)}.\n- Preserve Slopflow's CLI-runbook model; do not introduce autonomous orchestration unless explicitly approved.\n- Do not add dependencies without justification and review.\n\n` +
    `## Out of Scope\n\n- Work not requested by the source issue.\n- Publishing, pushing, merging, creating PRs, or closing issues unless separately requested.\n\n` +
    `## Required Quality Gates\n\n- Test evidence is required unless an explicit test exception is written and accepted by review.\n- Reviewer verdict is required before completion.\n- Browser or design evidence is required only if this contract is updated to require it.\n\n` +
    `## Blocked-Stop Conditions\n\n- Acceptance criteria cannot be extracted from the issue.\n- Required external tools or credentials are unavailable.\n- The implementation would expand beyond the source issue.\n- Quality gates cannot run and no reviewed test exception exists.\n\n` +
    `## Completion Criteria\n\n- Implementation matches the issue execution contract.\n- Required quality gates have evidence.\n- Reviewer verdict is complete.\n- Completion note summarizes changes, tests, review result, and limitations.\n`;
}


export function buildGoalPrompt(contract: string): string {
  return `Create a Pi goal mirror from this Slopflow issue execution contract. The contract is canonical; the Pi goal is only a runtime mirror.\n\n${contract}`;
}


export function buildNextSteps(issueReference: IssueReference): string {
  return `# Next Steps\n\n` +
    `1. Read \`contract.md\` and confirm scope for ${issueText(issueReference)}.\n` +
    `2. Create a Pi goal mirror from \`goal-prompt.md\` if working inside Pi.\n` +
    `3. Plan the smallest implementation that satisfies the contract.\n` +
    `4. Implement only the contract scope.\n` +
    `5. Capture test evidence with Slopflow when the test command exists.\n` +
    `6. Do not mark complete until reviewer verdict and required evidence exist.\n`;
}


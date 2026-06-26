import { createHash } from "node:crypto";
import { join } from "node:path";

import type { WorkItemKind, WorkItemReference, MachineConfig, WorkItem, WorkItemComment } from "./types.js";
import { SlopflowError } from "./types.js";

export function parseStartWorkItemReference(args: string[], config: MachineConfig): WorkItemReference {
  const flagNames = new Set(["--provider", "--repository", "--base-url", "--kind", "--id"]);
  const positional = args.filter((arg, index) => !arg.startsWith("--") && !flagNames.has(args[index - 1] ?? ""));
  const id = flagValue(args, "--id") ?? positional[0];
  if (!id) {
    throw new SlopflowError("Missing provider-native id.", "Run `slopflow start <provider-native-id>`.", 2);
  }
  const provider = flagValue(args, "--provider") ?? config.issue_tracker.provider;
  const repository = flagValue(args, "--repository") ?? config.issue_tracker.repository;
  const kind = (flagValue(args, "--kind") ?? "issue") as WorkItemKind;
  return normalizeWorkItemReference({
    provider,
    base_url: normalizeBaseUrl(flagValue(args, "--base-url") ?? config.issue_tracker.base_url ?? defaultBaseUrl(provider)),
    repository,
    kind,
    id,
  });
}


export function flagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}


export function normalizeWorkItemReference(value: unknown): WorkItemReference {
  const issue = value as Partial<WorkItemReference> | undefined;
  const provider = issue?.provider ?? "";
  const repository = issue?.repository ?? issue?.repo ?? "";
  const id = issue?.id ?? (typeof issue?.number === "number" ? String(issue.number) : "");
  const kind = issue?.kind ?? "issue";
  const baseUrl = normalizeBaseUrl(issue?.base_url ?? defaultBaseUrl(provider));
  return {
    provider,
    base_url: baseUrl,
    repository,
    kind,
    id,
    ...(issue?.url ? { url: issue.url } : {}),
    ...(issue?.repo ? { repo: issue.repo } : provider === "github" ? { repo: repository } : {}),
    ...(typeof issue?.number === "number" ? { number: issue.number } : provider === "github" && /^\d+$/.test(id) ? { number: Number(id) } : {}),
  };
}


export function defaultBaseUrl(provider: string): string {
  if (provider === "github") return "https://github.com";
  if (provider === "gitlab") return "https://gitlab.com";
  return "";
}


export function normalizeBaseUrl(value: string): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.toLowerCase().replace(/\/$/, "");
  }
}


export function buildWorkKey(reference: WorkItemReference): string {
  const normalized = normalizeWorkItemReference(reference);
  const slug = slugifyWorkKey([normalized.provider, normalized.repository, normalized.kind, normalized.id].join("-"));
  const hash = createHash("sha256")
    .update(stableStringify({
      provider: normalized.provider,
      base_url: normalized.base_url,
      repository: normalized.repository,
      kind: normalized.kind,
      id: normalized.id,
    }))
    .digest("hex")
    .slice(0, 8);
  return `${slug}-${hash}`;
}


export function slugifyWorkKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "issue";
}


export function summarizeText(value: string, limit = 300): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}


export function formatCommentsMarkdown(comments: WorkItemComment[]): string {
  if (comments.length === 0) return "_No comments captured._\n";
  return comments.map((comment) => `### ${comment.author}${comment.created_at ? ` at ${comment.created_at}` : ""}\n\n${comment.body}`).join("\n\n");
}


export function buildWorkItemContext(item: WorkItem): string {
  return `Description:\n\n${item.description || "No issue description provided."}\n\n` +
    `Comments:\n\n${formatCommentsMarkdown(item.comments)}` +
    `\nLabels: ${item.labels.length > 0 ? item.labels.join(", ") : "none"}`;
}


export function workItemText(issue: WorkItemReference): string {
  const normalized = normalizeWorkItemReference(issue);
  return `${normalized.provider}:${normalized.repository} ${normalized.kind} ${normalized.id}`;
}



export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

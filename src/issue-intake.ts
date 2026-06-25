import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

import { defaultBaseUrl, normalizeBaseUrl, normalizeWorkItemReference, summarizeText } from "./issue-model.js";
import type { WorkItemReference, WorkItem, WorkItemComment } from "./types.js";
import { SlopflowError } from "./types.js";

export function readWorkItem(reference: WorkItemReference): WorkItem {
  if (reference.provider === "github") return fetchGitHubWorkItem(reference);
  if (reference.provider === "gitlab") return fetchGitLabWorkItem(reference);
  throw new SlopflowError(
    `Unsupported issue tracker provider: ${reference.provider}.`,
    "Configure a supported issue tracker provider.",
    2,
  );
}


export function fetchGitHubWorkItem(reference: WorkItemReference): WorkItem {
  const fields = "number,title,body,url,state,comments,labels";
  const issueArgs = ["issue", "view", reference.id, "--repo", reference.repository, "--json", fields];
  const issue = runGhJson(issueArgs);
  if (issue.ok) {
    return normalizeGitHubWorkItem(issue.value, { ...reference, kind: "issue" });
  }
  if (!issue.notFound) {
    throw githubCommandError(issue);
  }

  const prArgs = ["pr", "view", reference.id, "--repo", reference.repository, "--json", fields];
  const pr = runGhJson(prArgs);
  if (pr.ok) {
    return normalizeGitHubWorkItem(pr.value, { ...reference, kind: "pull_request" });
  }
  if (!pr.notFound) {
    throw githubCommandError(pr);
  }
  throw new SlopflowError(
    `Could not read GitHub issue or PR ${reference.id} from ${reference.repository}.`,
    "Ensure the issue or PR exists in the configured repository.",
    2,
    {
      command: `gh ${issueArgs.join(" ")} && gh ${prArgs.join(" ")}`,
      "exit-code": pr.exitCode,
      detail: summarizeCommandFailure(pr),
      "next-step": `verify ${reference.id} exists in ${reference.repository}`,
    },
  );
}


export function fetchGitLabWorkItem(reference: WorkItemReference): WorkItem {
  const encodedProject = encodeURIComponent(reference.repository);
  const hostArgs = gitLabHostArgs(reference.base_url);
  const issue = runGlabJson([...hostArgs, "api", `projects/${encodedProject}/issues/${encodeURIComponent(reference.id)}`]);
  if (!issue.ok) {
    throw gitlabCommandError(issue);
  }
  const notes = runGlabJson([...hostArgs, "api", `projects/${encodedProject}/issues/${encodeURIComponent(reference.id)}/notes?per_page=100&order_by=created_at&sort=asc`]);
  if (!notes.ok) {
    throw gitlabCommandError(notes);
  }
  return normalizeGitLabWorkItem(issue.value, notes.value, reference);
}


export function gitLabHostArgs(baseUrl: string): string[] {
  const defaultUrl = normalizeBaseUrl(defaultBaseUrl("gitlab"));
  if (!baseUrl || normalizeBaseUrl(baseUrl) === defaultUrl) return [];
  try {
    return ["--hostname", new URL(baseUrl).host];
  } catch {
    return [];
  }
}


export type ProviderJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; tool: string; args: string[]; exitCode: number | string; stdout: string; stderr: string; message: string; notFound: boolean; spawnError?: string };


export function runGhJson(args: string[]): ProviderJsonResult {
  return runProviderJson("gh", args, "GitHub");
}


export function runGlabJson(args: string[]): ProviderJsonResult {
  return runProviderJson("glab", args, "GitLab");
}


export function runProviderJson(tool: string, args: string[], providerName: string): ProviderJsonResult {
  const result = spawnSync(tool, args, { encoding: "utf8" });
  if (result.error) {
    return {
      ok: false,
      tool,
      args,
      exitCode: "spawn-error",
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      message: result.error.message,
      notFound: false,
      spawnError: result.error.message,
    };
  }
  if (result.status !== 0) {
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    return {
      ok: false,
      tool,
      args,
      exitCode: typeof result.status === "number" ? result.status : 1,
      stdout,
      stderr,
      message: summarizeText(stderr || stdout || `${tool} command failed`),
      notFound: isLikelyNotFound(stdout, stderr),
    };
  }
  try {
    return { ok: true, value: JSON.parse(result.stdout) };
  } catch (error) {
    return {
      ok: false,
      tool,
      args,
      exitCode: 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      message: error instanceof Error ? error.message : `${providerName} JSON parse failed`,
      notFound: false,
    };
  }
}


export function githubCommandError(failure: Exclude<ProviderJsonResult, { ok: true }>): SlopflowError {
  return new SlopflowError(
    "GitHub command failed while reading issue work.",
    nextStepForProviderFailure(failure, "GitHub"),
    2,
    {
      command: `${failure.tool} ${failure.args.join(" ")}`,
      "exit-code": failure.exitCode,
      detail: summarizeCommandFailure(failure),
      "next-step": nextStepForProviderFailure(failure, "GitHub"),
    },
  );
}


export function gitlabCommandError(failure: Exclude<ProviderJsonResult, { ok: true }>): SlopflowError {
  return new SlopflowError(
    "GitLab command failed while reading issue work.",
    nextStepForProviderFailure(failure, "GitLab"),
    2,
    {
      command: `${failure.tool} ${failure.args.join(" ")}`,
      "exit-code": failure.exitCode,
      detail: summarizeCommandFailure(failure),
      "next-step": nextStepForProviderFailure(failure, "GitLab"),
    },
  );
}


export function summarizeCommandFailure(failure: Exclude<ProviderJsonResult, { ok: true }>): string {
  const parts = [failure.message, summarizeText(failure.stderr), summarizeText(failure.stdout)].filter(Boolean);
  return parts.length > 0 ? parts.join(" | ") : `${failure.tool} command failed`;
}


export function isLikelyNotFound(stdout: string, stderr: string): boolean {
  const text = `${stdout}\n${stderr}`.toLowerCase();
  return /not found|could not resolve|no .* found|404/.test(text) && !isLikelyAuthFailure(stdout, stderr);
}


export function isLikelyAuthFailure(stdout: string, stderr: string): boolean {
  return /auth|authentication|authorize|login|401|403|forbidden|permission/i.test(`${stdout}\n${stderr}`);
}


export function nextStepForProviderFailure(failure: Exclude<ProviderJsonResult, { ok: true }>, providerName: "GitHub" | "GitLab"): string {
  const tool = providerName === "GitHub" ? "gh" : "glab";
  if (failure.spawnError) {
    return `install ${providerName} CLI \`${tool}\` and ensure it is on PATH`;
  }
  if (isLikelyAuthFailure(failure.stdout, failure.stderr)) {
    return `${tool} auth login`;
  }
  if (failure.exitCode === 0) {
    return `inspect ${tool} JSON output or update ${providerName} response parsing`;
  }
  return `inspect ${tool} output and retry`;
}


export function normalizeGitHubWorkItem(value: unknown, reference: WorkItemReference): WorkItem {
  const item = value as {
    number?: unknown;
    title?: unknown;
    body?: unknown;
    url?: unknown;
    state?: unknown;
    comments?: unknown;
    labels?: unknown;
  };
  if (typeof item.number !== "number" || typeof item.title !== "string") {
    throw new SlopflowError("GitHub returned an unexpected issue shape.", undefined, 2);
  }
  const ref = normalizeWorkItemReference({
    ...reference,
    id: String(item.number),
    url: typeof item.url === "string" ? item.url : reference.url,
    repo: reference.repository,
    number: item.number,
  });
  return {
    ref,
    title: item.title,
    description: typeof item.body === "string" ? item.body : "",
    url: ref.url ?? "",
    state: typeof item.state === "string" ? item.state : "unknown",
    comments: normalizeProviderComments(item.comments),
    labels: normalizeProviderLabels(item.labels),
  };
}


export function normalizeGitLabWorkItem(value: unknown, notes: unknown, reference: WorkItemReference): WorkItem {
  const item = value as {
    iid?: unknown;
    title?: unknown;
    description?: unknown;
    web_url?: unknown;
    state?: unknown;
    labels?: unknown;
  };
  if ((typeof item.iid !== "number" && typeof item.iid !== "string") || typeof item.title !== "string") {
    throw new SlopflowError("GitLab returned an unexpected issue shape.", undefined, 2);
  }
  const ref = normalizeWorkItemReference({
    ...reference,
    id: String(item.iid),
    url: typeof item.web_url === "string" ? item.web_url : reference.url,
  });
  return {
    ref,
    title: item.title,
    description: typeof item.description === "string" ? item.description : "",
    url: ref.url ?? "",
    state: typeof item.state === "string" ? item.state : "unknown",
    comments: normalizeProviderComments(notes),
    labels: normalizeProviderLabels(item.labels),
  };
}


export function normalizeProviderComments(value: unknown): WorkItemComment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((comment) => {
      const entry = comment as {
        body?: unknown;
        createdAt?: unknown;
        created_at?: unknown;
        author?: unknown;
        user?: unknown;
        system?: unknown;
      };
      if (entry.system === true || typeof entry.body !== "string" || entry.body.trim().length === 0) return null;
      const author = entry.author as { login?: unknown; username?: unknown; name?: unknown } | string | undefined;
      const user = entry.user as { login?: unknown; username?: unknown; name?: unknown } | string | undefined;
      return {
        author: normalizeProviderAuthor(author ?? user),
        created_at: typeof entry.created_at === "string" ? entry.created_at : typeof entry.createdAt === "string" ? entry.createdAt : "",
        body: entry.body,
      };
    })
    .filter((comment): comment is WorkItemComment => comment !== null);
}


export function normalizeProviderAuthor(value: unknown): string {
  if (typeof value === "string") return value;
  const author = value as { login?: unknown; username?: unknown; name?: unknown } | undefined;
  return typeof author?.login === "string" ? author.login : typeof author?.username === "string" ? author.username : typeof author?.name === "string" ? author.name : "unknown";
}


export function normalizeProviderLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((label) => {
      if (typeof label === "string") return label;
      const entry = label as { name?: unknown };
      return typeof entry.name === "string" ? entry.name : null;
    })
    .filter((label): label is string => label !== null);
}


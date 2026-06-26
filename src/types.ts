
export const SCHEMA_VERSION = 1;


export const DEFAULT_ARTIFACT_ROOT = ".slopflow/work";


export const DEFAULT_PRS_AS_REQUEST_SURFACE = true;


export const REVIEW_DIFF_LIMIT = 50_000;


export type MachineConfig = {
  schema_version: number;
  artifact_root: string;
  workspace_root?: string;
  issue_tracker: {
    provider: string;
    repository: string;
    base_url?: string;
    prs_as_request_surface: boolean;
  };
  vcs: {
    type: "jj" | "git" | string;
  };
};


export type SupportedVcs = "jj" | "git";


export type IssueKind = "issue" | "pull_request" | "merge_request";


export type IssueReference = {
  provider: string;
  base_url: string;
  repository: string;
  kind: IssueKind;
  id: string;
  url?: string;
  repo?: string;
  number?: number;
};


export type TrackedItem = {
  ref: IssueReference;
  title: string;
  description: string;
  url: string;
  state: string;
  comments: TrackedItemComment[];
  labels: string[];
};


export type TrackedItemComment = {
  author: string;
  created_at: string;
  body: string;
};


export type TestAttempt = {
  attempt_id: string;
  name: string;
  command: string;
  status: "passed" | "failed";
  exit_code: number;
  log: string;
  started_at: string;
  finished_at: string;
};


export type TestLatest = {
  attempt_id: string;
  status: TestAttempt["status"];
  exit_code: number;
  log: string;
};


export type TestEvidence = {
  schema_version: 1;
  latest: Record<string, TestLatest>;
  attempts: TestAttempt[];
};


export type ReviewVerdict = {
  schema_version: 1;
  verdict: "complete" | "changes-requested";
  reviewer: string;
  reviewed_at: string;
  summary: string;
  required_changes: string[];
};


export type WorkLifecycleStatus = "started" | "active" | "paused" | "cancelled" | "complete";


export type AgentAttemptStatus = "created" | "active" | "submitted" | "selected" | "rejected" | "abandoned";


export type AgentAttempt = {
  schema_version: 1;
  issue_id: string;
  attempt_id: string;
  status: AgentAttemptStatus;
  created_at: string;
  updated_at: string;
  submitted_at?: string;
  abandoned_at?: string;
  abandon_reason?: string;
};


export type AttemptWorkspace = {
  schema_version: 1;
  kind: "jj-workspace" | "git-worktree";
  path: string;
  created_at: string;
  workspace_name?: string;
  branch?: string;
  base_ref?: string;
};


export type AttemptWorkspacePointer = {
  schema_version: 1;
  canonical_repository: string;
  issue_id: string;
  attempt_id: string;
};


export type ArtifactLockScope = "work" | "attempt" | "selection";


export type WorkStatus = {
  schema_version?: number;
  status?: WorkLifecycleStatus | string;
  issue: IssueReference;
  [key: string]: unknown;
};


export class SlopflowError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
    readonly code = 1,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}


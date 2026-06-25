---
type: Guide
title: Agent attempts
description: How Slopflow coordinates parallel agent attempts through local artifacts and isolated execution workspaces.
tags: [agent-attempts, parallel-work, workflow]
---

# Agent attempts

For parallel agent work, Slopflow coordinates **agent attempts** as artifacts and isolated execution workspaces. Core Slopflow does not launch or supervise agents; it prepares attempt directories, workspaces, evidence targets, comparison packets, selection records, and promotion metadata.

## Create attempts

Create attempts for an already-started work item execution:

```bash
slopflow attempt create <work-key-or-provider-native-id> --count 3
slopflow attempt list <work-key-or-provider-native-id>
slopflow attempt status <work-key-or-provider-native-id> a1
```

Each attempt stores artifacts under:

```text
.slopflow/work/<work-key>/attempts/a1/
  attempt.json
  workspace.json
  goal-prompt.md
  summary.md
  evidence/
```

`attempt create` creates an isolated version-control workspace by default and writes a pointer in that workspace:

```text
.slopflow-attempt.json
```

The pointer lets Slopflow commands run from the attempt workspace while writing evidence back to the canonical repository’s `.slopflow/work/<work-key>/` artifacts.

## Record attempt evidence

Record attempt-scoped evidence from the attempt workspace:

```bash
slopflow test <work-key-or-provider-native-id> --attempt a1 --name unit -- npm test
```

Attempt-scoped evidence is written under the selected attempt, not canonical work item evidence, and does not satisfy completion gates until the attempt is selected and promoted.

## Submit, compare, select, and promote

```bash
slopflow attempt submit <work-key-or-provider-native-id> a1
slopflow attempt compare <work-key-or-provider-native-id>
slopflow attempt select <work-key-or-provider-native-id> a1 --reason "best evidence and smallest diff"
slopflow attempt promote <work-key-or-provider-native-id>
```

Selection records an auditable decision. Promotion is artifact-only: it copies or references selected attempt evidence and records the selected execution workspace. It does not merge, cherry-pick, apply patches, push, publish, create a PR, approve review, or complete work.

After promotion, run review and completion from the selected execution workspace:

```bash
cd /path/to/selected/attempt/workspace
slopflow review <work-key-or-provider-native-id>
slopflow complete <work-key-or-provider-native-id>
```

If invoked from the canonical repository checkout after promotion, review and completion block with a next step pointing to the selected execution workspace.

## Abandon attempts

Attempts can be abandoned without deleting their artifacts:

```bash
slopflow attempt abandon <work-key-or-provider-native-id> a2 --reason "superseded by a1"
```

## Workspace root

By default attempt workspaces live outside the canonical repository under a sibling workspace root. `.slopflow/config.json` includes:

```json
{
  "workspace_root": ".slopflow-workspaces"
}
```

Relative `workspace_root` values resolve next to the canonical repository, not inside it.

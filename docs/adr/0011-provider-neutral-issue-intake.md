---
type: ADR
title: Provider-neutral issue intake uses adapter-backed tracked items
description: Slopflow reads provider-hosted work requests through issue tracker provider adapters while preserving local issue execution contracts as the source of truth.
tags: [architecture, issue-intake, issue-tracker]
---

# ADR 0011: Provider-neutral issue intake uses adapter-backed tracked items

## Status

Accepted

## Context

Slopflow originally read GitHub issues directly through GitHub-specific configuration, command output, and artifact identifiers. The domain model now treats issue tracker providers as external systems and issue references as structured provider/repository/kind/id values.

Slopflow must support other providers without becoming a forge client, GitHub replacement, synchronization engine, or agent runtime.

## Decision

Slopflow issue intake reads one tracked item through an issue tracker provider adapter. The adapter fetches provider content and returns a neutral tracked item containing the normalized issue reference, title, description, chronological comments, optional labels, state, and URL.

Issue intake is one-shot. After intake, the local issue execution contract is the source of truth. Provider item edits do not implicitly update Slopflow artifacts.

Adapter transport is provider-owned. GitHub and GitLab start with CLI-backed adapters, while future providers may use HTTP when that is the safer transport.

Work directories use generated work keys instead of provider-native ids. The semantic issue reference remains stored in artifacts separately from the storage key.

The first provider-neutral slice keeps GitHub behavior working through the adapter boundary. GitLab issue intake is the first second-provider proof point.

## Consequences

- Slopflow core generates issue execution contracts from neutral tracked items, not provider-specific API shapes.
- Provider adapters must not infer acceptance criteria, quality gates, or completion state.
- Stored tracked item snapshots provide local provenance for the one-shot intake input.
- Existing GitHub numeric work directories remain a compatibility concern, but new issue work can use collision-resistant work keys.
- Provider-specific triage operations, label mutation, closing issues, and synchronization remain outside the first issue-intake scope.

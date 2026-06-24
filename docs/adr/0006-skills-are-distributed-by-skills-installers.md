# Harness workflow packs are installed project-locally

Slopflow's npm package distributes the CLI plus Slopflow skill pack assets. Minimal Slopflow repository state is initialized by `slopflow init`, which writes only `.slopflow/config.json` and `.slopflow/work/`.

Harness-specific onboarding is handled by `slopflow install --harness pi|claude-code|generic`. The install command is dry-run by default, requires `--yes` to write files, and writes only project-local harness directories:

- Pi: `.pi/skills/`, `.pi/extensions/`, `.pi/agents/`, and project `.pi/settings.json` package entries.
- Claude Code: `.claude/skills/`.
- Generic Agent Skills-compatible harnesses: `.agents/skills/`.

The CLI must not write to user/global Claude, Pi, Cursor, or other agent harness configuration. It must not install global packages, push, publish, create PRs, close issues, or merge changes as part of harness installation. Existing project-local harness pack files that differ from the Slopflow pack block unless rerun with explicit `--force`.

The repository continues to distribute both execution skills (`slopflow`, `slopflow-live`) and setup skills (`setup-slopflow-skills`, `setup-slopflow-skills-live`). Harness workflow packs copy the appropriate portable or live variants into the selected project's local harness directory so other agents can share the same Slopflow workflow contract.

# Skills are distributed by skills installers

Slopflow's npm package distributes the CLI, while agent skills live in the repository and are installed by skills tooling such as Vercel Skills. The Slopflow CLI does not manage Claude, Pi, Cursor, or other agent harness skill directories, because skill placement is a harness-specific concern outside the CLI-runbook boundary.

The repository distributes both execution skills (`slopflow`, `slopflow-live`) and setup skills (`setup-slopflow-skills`, `setup-slopflow-skills-live`). In a newly onboarded project, agents should run one setup skill first so the project's issue tracker, triage label vocabulary, and domain-documentation layout are recorded before issue execution starts.

# Skills are distributed by skills installers

Slopflow's npm package distributes the CLI, while agent skills live in the repository and are installed by skills tooling such as Vercel Skills. The Slopflow CLI does not manage Claude, Pi, Cursor, or other agent harness skill directories, because skill placement is a harness-specific concern outside the CLI-runbook boundary.

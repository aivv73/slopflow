# Complete is a local artifact gate

`slopflow complete` is a local artifact gate, not a publishing action. It requires reviewer approval and either passing latest test evidence or a reviewed test exception, preserves an existing completion note or generates one when missing, updates local status metadata, verifies configured VCS status is readable, and never pushes, publishes, opens PRs, merges, or closes issues. Jujutsu is recommended, but Git repositories are supported.

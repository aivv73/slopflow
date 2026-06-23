# Lifecycle commands are artifact state transitions

Slopflow lifecycle commands such as `pause`, `resume`, and `cancel` manage local issue work artifacts and `status.json` state. They do not control an agent runtime, run pending work, mutate Jujutsu history, push, publish, close issues, or delete evidence. This keeps Slopflow within the CLI-runbook boundary: the CLI records and reports safe workflow state, while humans or agents perform any external process, VCS, or issue-tracker actions explicitly.

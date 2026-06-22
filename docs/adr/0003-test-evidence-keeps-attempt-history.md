# Test evidence keeps attempt history

Slopflow test evidence uses append-only attempts plus a latest-result index per gate. This preserves reviewable failure history while letting completion checks read the current state directly; `slopflow test` runs commands from the repository root, writes standalone logs with metadata/stdout/stderr sections, and returns the wrapped command's exit code by default.

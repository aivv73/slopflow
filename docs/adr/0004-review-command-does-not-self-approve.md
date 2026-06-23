# Review command does not self-approve

`slopflow review` prepares a bounded review packet and validates an existing reviewer verdict, but it never writes `review.json`. Reviewer approval must come from a separate human or agent reviewer, invalid verdict files block the review gate, and missing test evidence is surfaced for the reviewer rather than blocking packet creation.

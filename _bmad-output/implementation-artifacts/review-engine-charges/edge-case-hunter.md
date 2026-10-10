# Reviewer prompt: Edge Case Hunter (gds-code-review, story engine-charges, #914)

Run this in a fresh session with read access to /home/user/vc-charges (the
branch `claude/engine-charges`). Get the diff:

    git -C /home/user/vc-charges diff origin/claude/engine-catalog...claude/engine-charges -- . ':!src/public/engine'

Then run the `bmad-review-edge-case-hunter` skill on that diff as its
content. You may read the project to follow referenced functions (for
example `Tower.resizeTransport`, `Tower.setCars`, `extendBill`,
`removalReason`, the Rust ports in `engine-rs/src/tower.rs`). Return only the
skill's JSON array of findings and paste it back into the review session.

# Reviewer prompt: Blind Hunter (gds-code-review, story engine-charges, #914)

Run this in a fresh session with no project context. You get the diff only:
do not open any other file, spec or doc.

Get the diff (exclude the generated WASM package):

    git -C /home/user/vc-charges diff origin/claude/engine-catalog...claude/engine-charges -- . ':!src/public/engine'

Then run the `bmad-review-adversarial-general` skill on that diff as its
content. Output findings as a Markdown list (descriptions only), and paste
them back into the review session.

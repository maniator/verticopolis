# Review record: #985 slice 2b-1 (reason-specific engine failure screens)

`/bmad-code-review`, full mode, plumbing surface. Layers: Blind Hunter (diff
only), Edge Case Hunter (diff and repo), Acceptance Auditor (story plan and
design 5.4). Reviewed head ec9046ad, fixed in the next commit.

## Patched

- A `package-mismatch` code beat a `load-failed` detail, so a load-failed
  detail carried under that code read as a mismatch. The mismatch sentence now
  applies unless the detail says `load-failed`.
- A `package-mismatch` with no detail (a link error, a binding check, a worker
  detail that the cleaner dropped) showed the raw message. It now gets the
  mismatch sentence with "unavailable" ids.
- A `boot-error` at the load stage with no detail showed the raw message,
  though design 5.4 gives import and init failures the load-failed sentence.
  Every load-stage failure now has a sentence; start and host failures keep
  their message.
- "Connect to the internet" was shown to online players. It now reads "Try
  Reload." when online.
- A build with no engine package (`expectedPackage` null) now says a corrected
  deployment is needed (design 5.4).
- The missing save writer was chosen by comparing the message. It now has a
  `cause: "no-save-writer"` on the failure, set by `loadBootEngine`, and a test
  that the boot produces it.
- Equal package ids ("expected X, found X") now name the file that differs.
- `unverifiable` on a secure connection (a hashing failure) told the player to
  open the game over HTTPS. A secure page now gets a plain retry sentence, an
  insecure one keeps the design copy, the first step matches it, the offline
  hint is dropped there, and a start or host stage is not affected.
- Tests: a rendered-screen test over mismatch, load-failed, timeout and the
  save writer (role alert, first step, focus on Reload), the combinations the
  reviewers listed, and a stricter id pattern in the e2e.
- Style: the "not Reload" and "never from the message" phrasings are gone from
  the comment, the test titles, the story and the backlog row; the import order
  nit went with the constant becoming private.

## Dismissed

- Timeout copy blames the connection: the sentence is the design's wording;
  a compile that overruns the deadline is the rarer case.
- Mismatch gives no cause and only Reload: Repair is slice 2b-2.

## Independent review round (reviewer 2, 315a78a0)

- C1 (patch, fixed): nothing tested the `isSecureContext` wiring in `showEngineFailure`. `src/bootstrapEngineSecure.test.ts` shows an `unverifiable` failure with the context stubbed insecure (the HTTPS sentence) and secure (the reload or another browser sentence), so a constant-true or constant-false mutant fails.

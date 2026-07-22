# Transparency note (player-facing copy)

Spec-authored companion to `SPEC.md`. Ready-to-drop copy for the "what we measure and why" line that ships with the migration (Help or Settings). Plain, human, American English, no em-dashes. The claim must stay true to the SPEC and `reverse-proxy.md`: only anonymous, low-cardinality counts leave the device, through our own same-origin relay, with no cookie and no cross-session identifier.

## Short line (Settings footer or Help privacy row)

> **What we measure.** The game keeps a few anonymous counts to see how new players get started, how far towers get, and whether returning players progress further. We use no cookies, store nothing that identifies you, and send only those anonymous counts through our own site. There is nothing to accept or turn off.

## Longer paragraph (Help "Privacy" subsection)

> Verticopolis keeps a small, anonymous read on how the game is going: whether new players place their first facility, how far towers climb the star ladder, which tools get used, and whether returning players get further than first-timers. Those signals are worked out on your own device and sent as coarse, anonymous counts through our own site (not to a third-party tracker in your browser), with no cookie and nothing that could point back to you across visits. No account, no cross-site tracking, and no consent banner, because there is nothing here to consent to. The counts help decide what to improve; they are never sold or shared.

## Copy rules

- No em-dashes; use commas, colons, parentheses, or separate sentences.
- No "X, not Y" emphatic-restatement pattern; no AI-marketing vocabulary.
- If the data posture changes (for example if a persistent identifier is ever introduced), this copy and the relevant `SPEC.md` capabilities change together (CAP-3, the returning signal and on-device buckets; and CAP-2, the cookieless transport). The line "nothing that identifies you across visits" must remain literally true: the transport uses an in-memory session id that dies with the tab and an anonymous on-device returning bucket, never a persisted identifier.

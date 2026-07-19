# Decision Log - Crowd Din and Venue Ambience

All decisions were made by the owner across nine audition rounds (2026-07-17),
each against rendered preview WAVs. This log records them for traceability;
the GDD carries the resulting specs.

| # | Decision | Context |
| - | -------- | ------- |
| 1 | Real recordings over procedural synthesis and over CC0 sourcing | Two procedural crowd rounds rejected ("static", "muffled train tracks"); session egress policy blocks external sample libraries; owner offered to record. |
| 2 | Ship audio files (a first for the project), owner-recorded, tiny | Owner approved the shift from the all-procedural design; budget "small, don't blow out the application". |
| 3 | Footsteps cut entirely | Three rounds rejected: "too stompy", "odd", "horses clip-clopping". Murmur carries the crowd; the original 1994 game had no footsteps either. |
| 4 | Voices pitch down only, never up | "Sounds like mice/chipmunks" on symmetric shifts; formants rise with pitch. |
| 5 | Long natural phrases, never short swelling chunks | Chipmunk persisted after the pitch fix; the 0.35-0.7 s chunking was the real cause. |
| 6 | Crying/laughing regions hard-cut from the talk seed | Owner disclosed fake crying/laughing in the recording; pitch-mapping found about 6.5 s across four regions (7.3-7.9, 13.4-15.0, 16.0-19.3, 21.2-22.2 s). |
| 7 | Laugh outtakes A and B kept as the party's laugh seed; C unused, D judged the cry | Burst-rhythm classification, offered to the owner for veto; no veto raised. |
| 8 | No sustained low tone clusters | "Lawnmower" on both the melded music draft and cinema v3's chord swells; plucked/decaying notes replace swells everywhere. |
| 9 | All noise steep-filtered (4-pole / rolloff -48), seated low | "Static/white noise" on every single-pole noise element (wind, cart, train, air-handler); steep refilter approved (hotel, metro). |
| 10 | Outside is noise-free | Even dark wind rejected; approved kit is hum + pedestrians + birds + horn; rain layer unchanged handles weather. |
| 11 | Office typing seated far back | "Ticks too loud and in your face"; volume to a third, dulled, longer pauses; phone call carries the scene. |
| 12 | Party is music-first: a 124 BPM remix of the game's own hook | "Party just sounds like lobby, should have some upbeat tunes"; occasional talking only, plus laughs and voice-bent whoops. |
| 13 | Cinema score voiced above 110 Hz with mid-partial booms | "Didn't really hear anything": the first draft lived below what small speakers reproduce. |
| 14 | Service floors keep the existing room tone; no new sound | Least-viewed area; the current bed never drew a complaint. |
| 15 | Metro trains are events with a wheel rhythm, not a noise loop | Da-dum arrival/departure approved in the de-static round. |
| 16 | Restaurant is quiet-ambient with occasional conversation | "More ambient and quieter, occasional conversation" versus the constant-murmur draft. |
| 17 | Spec then implement in one PR, `/gds-code-review`, preview for sign-off | Owner instruction closing the audition phase. |
| 18 | Review triage (same session): `/gds-code-review` ran its three layers over the implementation; every mechanics deviation was patched back to spec (silence threshold, talker formula, per-scene murmur gains and voices, element rate scaling, cluster math, program gating, census throttle) and three fine-texture prototype details were deferred to the backlog rather than silently dropped. | Findings summarized in the PR; defers in the backlog inbox. |
| 19 | Phone crackle ruling: the audio context runs with the `playback` latency hint and capped polyphony. | Owner reported random static crackles on phone only (both prod and preview): buffer underruns, not synthesis. |
| 20 | Volume sliders became perceptual (stored value squared at the bus). | Owner reported the music slider "doesn't seem to change the volume": linear gain reads as flat across most of the travel. |
| 21 | Ambience got its own bus and Settings slider (Music / Ambience / Effects). | Owner heard the talking only with music high: the crowd layer rode the music bus, so the two could not be balanced against each other. |
| 22 | Commercial venue census reads `customersIn`, not `occupants`. | Copilot review: the economy pass stamps an open restaurant's `occupants` to full catalog population, so an empty-but-open venue read as packed, breaking honest-rooms loudness. |
| 23 | Layer loudness scales with the SQUARE ROOT of activity, not linearly. | Owner heard "just a hum" over metro, cinema, and food places: linear activity gain read as near-silent for any lightly-visited venue, the same logarithmic-loudness fallacy the perceptual sliders fixed (row 20). Empty rooms still gate to exactly zero. |
| 24 | Talkers floor at ONE while the room is live, not the pure `round(maxTalkers * crowd)`. | Same "just a hum" report: rounding a sparsely-occupied room (3 talkers times 0.14 fill) to zero muted every quiet-but-occupied venue. This deliberately supersedes the row-18 triage that had removed the floor per Copilot; honest silence now comes only from the activity gate (nobody there), not from rounding a live room to zero. A couple in a big restaurant is a quiet conversation, not silence. |
| 25 | The metro platform gets a crowd floor (0.3), like the street. | The platform belongs to the city, not the tower: trains run and riders pass through regardless of the tower's drawn crowd, so the station and its train events never fall fully silent. The `crowdFloor` exception now reads "the city's own spaces" (street and platform), still never the tower's indoor rooms. |

Finalization: GDD and epics drafted 2026-07-17 from the audition record;
validation pass run before implementation began in the same session; review
triage deltas (rows 18-20) folded back into the GDD the same day.

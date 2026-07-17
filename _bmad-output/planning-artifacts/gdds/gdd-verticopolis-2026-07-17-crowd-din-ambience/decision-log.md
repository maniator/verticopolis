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

Finalization: GDD and epics drafted 2026-07-17 from the audition record;
validation pass run before implementation began in the same session.

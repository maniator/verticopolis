# Regression saves

Players' own towers, kept byte for byte as the game wrote them, for Rust
rule tests that replay a reported problem. Nothing reads this folder as a
whole: each test names its file.

| File | Saved by | What it replays |
| --- | --- | --- |
| `split-tower-26.vctower` | The owner, binary `.vctower` (Modern, 9 AM) | Riders above the lobby waiting over an hour at the evening rush while full cars stopped at every waiting floor (`rule_tests::full_car_passes`) |

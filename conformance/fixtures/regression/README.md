# Regression saves

Players' own towers, kept byte for byte as the game wrote them, for Rust
rule tests that replay a reported problem, and saves the engine wrote from
them for a rule test that must keep reading a field. Nothing reads this folder as a
whole: each test names its file.

| File | Saved by | What it replays |
| --- | --- | --- |
| `split-tower-26.vctower` | The owner, binary `.vctower` (Modern, 9 AM) | Riders above the lobby waiting over an hour at the evening rush while full cars stopped at every waiting floor (`rule_tests::full_car_passes`) |
| `split-tower-26-remembered.vctower` | The engine, from `split-tower-26.vctower` after 30 one-minute steps, binary `.vctower` | A save that carries the remembered elevator waits (`waitsSeen`), loaded and replayed by `rule_tests::remembered_waits` |
| `split-tower-29.vctower` | The owner, binary `.vctower` (Modern, 11:44 AM) | An Auto elevator re-tuned to one car every hour while about 190 people waited at its floor 1 and floor 15 stops, the 4.12.0 stall (`rule_tests::auto_backlog`) |
| `split-tower-31.vctower` | The owner, binary `.vctower` (Modern, 11:16 AM) | Hundreds of parking commuters standing in the basement lines at B1 to B3 while the Auto express elevators ran a few of their cars, the 4.13 morning rush (`rule_tests::auto_basement_rush`) |
| `split-tower-32.vctower` | The owner, binary `.vctower` (Modern, 9:57 AM) | About 1,400 parking commuters in the basement lines at B1 to B6 while three of the five Auto express elevators ran one or two cars and carried almost nobody, the 4.13.2 morning rush (`rule_tests::auto_idle_express`) |

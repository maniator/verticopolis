# Observation saves of the 1997 SimTower

These seven saves were written by the 1997 SimTower while it played two of the
Reddit saves in `../tdt-reddit/` forward. The repository owner ran the
original on their own computer to watch how it counts the visitors of shops,
fast food and restaurants (issue #1500), and agreed to commit this curated set
as test files. The starting towers are u/invokes's, credited in
`../tdt-reddit/README.md`.

| File | Started from | What it shows |
| --- | --- | --- |
| `T5O01.TDT`, `T5O35.TDT` | `TOWER5.TDT` | The first and last of 35 saves over several game days |
| `T7O01.TDT`, `T7O76.TDT` | `TOWER7.TDT` | The first and last of 76 saves over several game days |
| `FRESH0.TDT` | `TOWER5.TDT` | Day 23, just after a restaurant, two shops and two fast foods were built |
| `FRESH3A.TDT` | `FRESH0.TDT` | Day 26, a weekend evening, as the new venues reach their caps |
| `FRESH9A.TDT` | `FRESH0.TDT` | Day 32, every venue at its cap |

What they pin: each retail row's byte 8 is the visitors the room served
yesterday, and the finance block's shop, fast food and restaurant counts are
the sums of those bytes. `engine-rs/tests/tdt_observed_census.rs` loads every
file and checks that the engine's census matches the finance block class by
class, and that a played venue never counts more than its cap.

The files are the originals as the game wrote them. Do not add them to the
conformance lock (`conformance/tdt-cases.json`): its cases are synthetic.

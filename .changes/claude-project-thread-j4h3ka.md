---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Modern: people choosing an elevator now count every car of a shaft on Auto, since its parked cars come out as soon as anyone waits. Before, a shaft that Auto had parked down to one car looked slow, so nobody lined up for it and its cars stayed parked: in a busy tower one or two express elevators carried the whole morning rush from the parking floors while their twins stood idle, and the basement lines grew past a thousand people.
## Engine
- The Modern router's `stand_down` leaves a shaft whose schedule has `auto_tune` on at its whole fleet, instead of counting only the cars the dispatch last ran, and `crowd::banks` shares a bank's riders by an Auto shaft's whole fleet the same way. Regression `rule_tests::auto_idle_express` replays the owner's split tower 32. The conformance lock moves for `starter-modern` and `metro-express-modern`; every Classic scenario keeps its hashes.

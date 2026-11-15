---
app: minor
crate: minor
readmes: unchanged
---
## Player
- Modern towers can now build 48 elevator shafts instead of 24, still one limit shared by standard, service and express elevators. A lot with several towers has room to give each one its own banks. Classic keeps the original 24, and stairs and escalators keep their 64 in both modes.
## Engine
- Modern's elevator pool holds 48 shafts (`facilities::MODERN_ELEVATOR_SHAFT_CAP`, `MODERN_POOLED_CAPS`, `transport_pools(mode)`, `transport_cap(mode)`, `GameMode::builds_more_elevator_shafts`), so the catalog's Modern `elevators` pool reads 48 and a Modern save keeps up to 112 transports on load. Classic's pools are unchanged.

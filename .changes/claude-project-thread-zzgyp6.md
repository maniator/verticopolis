---
app: minor
crate: minor
---
## Player
- Security guards now fight fires: when a fire breaks out, each Security office sends its six guards down the outside emergency stairs to it, and you can watch them climb and work the burning room. They only help once they get there, and only from an office within 8 floors.
- Fire Rescue is now a helicopter you can see: it flies in, puts the fire out for good when it lands, sprays a while and flies off. The rooms already burning are still gutted. In Classic it costs $500,000, as in the 1994 game; Modern keeps its star-based price.
## Engine
- New `FireResponse` on `EventSystem::fire`: the guards Security sends to a fire by the emergency stairs and the rescue helicopter. `Simulation::advance_fire_response` runs each step; a paid rescue lands after `HELICOPTER_FLIGHT_MINUTES` instead of putting the fire out at once. Saves carry it as `events.fire` while a fire burns; an older save's fire gets its guards on the next step.
- `control_chance` takes Security's share from guards who reached the fire. `call_fire_rescue` refuses with `coming` while the helicopter is on its way. Classic's rescue costs a fixed $500,000 (`GameMode::fire_rescue_fixed_price`).
- New gameplay event `fire_out` (`by`: `security`, `rescue` or `burnedOut`). `VIEW_LAYOUT_VERSION` is 31: the frame header appends `fireResponseSeq`, and the binding adds `fireResponse()`.

---
app: patch
crate: patch
readmes: unchanged
---
## Player
- A tenant that leaves at the end of its notice is now named for what keeps it unhappy now. Before, if you fixed the problem it gave notice for (say, the rent) while another problem kept it down (say, a lobby too far away), the message still blamed the one you fixed.
## Engine
- At the end of a lease tenant's notice, a stamped cause that no longer holds is replaced by the current dominant gripe; a cause that still holds, a relocation, or a tenant with nothing wrong now keeps its stamp. The unmet-demand gripe facts read whether the room's own stretch of floor is reachable, not just its floor.

# Classic shop rules audit (Rust engine)

Snapshot of 2026-10-30, written against the public SimTower reference material listed under Sources below. The full text of those sources is not kept in this repository: the wiki is CC-BY-SA, and the GameFAQs guides and the official manual are copyrighted. This file states the rules in our own words and cites each source by name. Facts that come only from a GameFAQs guide (Aristotle47's timetable, BStuart's Mac crowd thresholds) are secondary claims and are marked as such. It is a dated record, not a live status; the engine and the backlog are the live source. Cinema, security, medical, recycling, housekeeping and parking are covered only by the wiki's room tables, so rules that only their own pages would carry are gaps, not findings. Where no source speaks, a rule is recorded as unknown and settled by testing the game, not by guessing.

Not covered here: facility widths and the metro station's placement (the .TDT widths work owns them) and the cathedral (its own thread). The Modern column is a proposal for the owner to approve; nothing in Modern changes until he does.

## Matches

Fast food, restaurant, shop, cinema and party hall costs, star unlocks, the 1-star fast food and 3-star rest, star thresholds (300, 1,000, 5,000, 10,000, 15,000), security and medical limits of 10, one metro and one cathedral, the 24-shaft elevator pool with 8 cars, the 64-link stairs and escalator pool, the housekeeping shift (noon to 5 pm, no new room after 4:30 pm, six maids a unit), and offices, condos and hotels barred from the basement.

## Mismatches

| # | Rule | Wiki | Ours (Classic) | Fix or ask | Modern |
|---|---|---|---|---|---|
| 1 | Metro needs transport on its floors | The wiki says the metro helps business only when its floors have transportation connected | Any operating station helped | Fixed (crate 0.24.4, app 2.65.0) | Keep current; metro rules are not the shop lane |
| 2 | Metro helps underground business only | The wiki says the metro improves business for underground facilities | +25% demand and rain relief tower-wide | Ask: needs a per-venue split of the demand pool | Match Classic once agreed |
| 3 | Basement bands | B1 to B4 good for shops, restaurants, fast food; B5 and B6 get no metro help and are unviable; B7 to B9 best for retail | A business over 2 floors from a lobby floor earns half, so B3 and deeper are halved even beside the metro | Ask: the metro reach in floors needs an in-game test | Match Classic |
| 4 | Fast food payout | Fixed at 9 pm by the day's peak crowd: -3,000, 2,000 or 5,000 | Smooth hourly income, 5,000 a day times the demand fraction | Ask: changes the economy | Keep current (its own model) |
| 5 | Restaurant payout and hours | Fixed at 11 pm: -6,000, 4,000 or 10,000; opens at 5 pm so no lunch trade | Smooth income; open 11 to 14 and 17 to 23 | Ask: hours change crowd traffic | Keep current |
| 6 | Retail shop | Daily rent 4,000 / 10,000 / 15,000 / 20,000 chosen by the player; evaluation from rent and customers; abandoned if low | No rent choice, income is demand times 20,000 | Ask: new rent control and UI | Keep current |
| 7 | Party hall hours | Parties 1 to 5 pm, 20,000 a day, 50 people | Open 17 to 24, cap 20 | Ask: hours and the 50 (pending with the owner) | Keep current |
| 8 | Cinema crowd | Cinema page infobox says 60; its prose and the Room table say 120 (source conflict) | 30 | Pending with the owner; no basis to pick 60 or 120 until tested in game | Keep current |
| 9 | Combined room limits | Cinema plus party hall 16 shared (not 16 each); fast food plus restaurant plus shop 512; parking 512 | Cinema 16 and party hall 16 separately; no 512 limits | Fix, but it changes the catalog pools and the lock, so a separate PR once the owner confirms Modern | Match Classic: the .TDT slot tables hold these counts in both modes |
| 10 | Venue capacity | Fast food 10 to 50, restaurant 20 to 100, shop 20 to 50 | 25, 35, 20 | Ask: feeds population and the census | Keep current |
| 11 | Movies | The Cinema page: the info window offers a new movie ($300,000) or a classic ($150,000), with seven new titles in order (Casual Friends, Dino Wars, The Making of a Star, Love in N.Y., Waikiki Moon, My Man of War, Christmas for Both of Us) and seven classics (Big Wave, Farewell to Morocco, Fear of Shark Teeth, Western Sheriff, Revenge of the Big Spider, Northwest Romance, Samurai Cop). The window shows the floor, the film, days playing, daily earnings and one of four ticket-sales lines (It's a Sellout!, New Movie showing!, Ticket Sales are average., Terrible Sales, change the movie.). No attendance or aging formula is given | A monthly film policy (auto, standard, blockbuster) at $150,000 and $300,000, no per-film choice or titles | Gap: engine command (Rust, Classic) plus UI; waits for the owner's wiki PDF | Keep current policy |
| 12 | Upkeep | Metro 100,000, security 20,000, recycling 50,000, ramp 10,000, escalator 5,000, car 10,000, express car 20,000, housekeeping 10,000, all quarterly | Monthly figures for service rooms | Verify against the Classic maintenance spec before touching | Keep current |
| 13 | Housekeeping underground | Hotels and housekeeping cannot be built underground | Only offices, condos and hotels are barred; housekeeping can go in the basement | Fixed (crate 0.24.4): housekeeping joins the no-basement kinds; existing basement rooms stay | Match Classic (done) |
| 14 | Restaurant price | Infobox 100,000, Room table 200,000 | 200,000 | Keep 200,000 (the FAQ and the Room table agree) | Same |

## Added by revision 3 (secondary source for the hours)

| # | Rule | Source | Ours (Classic) | Fix or ask | Modern |
|---|---|---|---|---|---|
| 15 | Cinema hours | Aristotle47 (GameFAQs): screenings 1 to 4 pm and 5 to 8 pm, closing and posting earnings at 8 pm | Open 12 to 24 | Ask: hours change crowd traffic; verify in game | Keep current |
| 16 | Shop and fast food hours | Aristotle47: open 10 am, close 9 pm, fast food income posted at 9 pm | Fast food 7 to 22, shop 10 to 21 | Ask: fast food opens at 10 per the guide; verify in game | Keep current |
| 5 (update) | Restaurant hours | Wiki and the guide agree: opens at 5 pm, income at 11 pm | Also opens 11 to 14 | Same ask as row 5, now backed by two sources | Keep current |
| 4 (update) | Fast food crowd levels | BStuart (Mac v1.2 only, treat as version-specific): 0 to 24 customers loses 3,000, 25 to 34 earns 2,000, 35 to 80 earns 5,000 | Smooth income | Needs a PC check before any threshold is coded | Keep current |

## Added by revision 4

Revision 4 adds only a follow-up note (no new wiki pages). It confirms what the audit already says: the Hotel page covers the housekeeping rules we have, Cinema hours and fast food thresholds stay secondary or Mac-only, and the metro's reach in floors is not stated anywhere. One finding came from re-reading the Hotel page against the engine:

| # | Rule | Source | Ours (Classic) | Fix or ask | Modern |
|---|---|---|---|---|---|
| 17 | Rooms that cannot be deleted | The Windows Read Me lists housekeeping, security, recycling, the metro, the cathedral and the movie theater as undeletable; the Hotel page and the infoboxes say the same for housekeeping, lobby and cathedral | Lobby tiles were already refused in both modes; the rest could be bulldozed | Housekeeping fixed in Classic (crate 0.24.4); security, recycling and the movie theater fixed (crate 1.0.2, app 2.68.0); a burned-out shell can still be cleared. The cathedral (the wedding hall in the game) is fixed too (app 2.72.0). The metro waits for its own change. The medical center is a source conflict (one table says removable), so it stays removable | Keep current (sellable) |
| 18 | 3-star Security | The Windows Help file asks for more than one Security Office to reach 3 stars | One office | Fixed (crate 1.0.1, app 2.67.0): two offices; a tower that already holds 3 stars keeps them | Same (parity default) |
| 19 | Elevator car sizes | Help file: standard 21, service 17, express 42 | Standard 21, express 42 matched; service was 10 | Fixed (crate 1.0.3, app 2.69.0): service 17. The `.TDT` header byte is unreliable (a PC save showed 21 in a service shaft) and keeps its old value | Same |
| 20 | Stairs and escalator reach | Manual: a person uses at most four sets of stairs and seven escalators per trip | `walkway_willingness` is 4 and 7, Classic only | Matches | Keeps current |
| 21 | Escalators serve commercial floors only | Manual (two guides disagree) | Refused on office floors in Classic | Matches | Escalators allowed on office floors |
| 22 | Transfers | Read Me: a person changes transport mode once; two GameFAQs guides say twice | Any number of changes, fewest-edges route | Ask: a cap changes which parts of a tower are reachable, so every saved tower could lose tenants. Needs the owner and an in-game test | Keep current |
| 23 | Preference order | Read Me: escalators, stairs, standard elevator, express; one guide orders it differently | Fewest edges, first-listed edge wins a tie | Ask: same reason as row 22 | Keep current |
| 24 | Express stops | Help file: every 15th floor whether or not a lobby is built there, and all underground floors | Express stops only at lobby floors and the ends of its span | Ask: stopping at basements and bare 15th floors changes how towers are built. Loading a `.TDT` also drops the basement stops the file's express shafts carry (#1532) | Keep current |
| 25 | Recycling | Manual: centers must be adjacent to operate, trucks need a service elevator stop | Capacity by population only (2,500 per center), no adjacency or truck rule | Ask: a new rule to model, not a bug | Keep current |
| 26 | Post-film shopping | Manual: movie visitors shop within five floors of the theater | Not modeled | Ask: new crowd behavior | Keep current |

Rows 19 to 26 come from the Windows Help file and Read Me checks of 2026-10-30. "Matches" means the Rust engine already does what the source says. Rows that change how every passenger routes are asks, because they move the whole simulation and need an in-game check first.

Open source conflicts the note flags and we do not settle: escalator use with offices (kiwizoid says commercial only, furdude2 says offices work), the cinema's capacity (60 versus 120), and whether films age.

The stair reach conflicts between sources (wiki five levels, Aristotle47 four); ours is 4. Left alone until tested.

## Gaps (pages not in the reference)

Standalone Security, Medical Center, Recycling Center, Parking, Housekeeping and Escalator pages (the directory lists Housekeeping and Escalator but their text could not be fetched; the others may not exist), the metro's reach in floors, the cinema's attendance and film aging, and the crowd thresholds on PC. Housekeeping's 19 rooms each is stated on the Hotel page and is emergent here.

## Sources

- Sim Tower Wiki (Fandom), community content under CC-BY-SA: [Sim Tower Wiki](https://simtower.fandom.com/wiki/Sim_Tower_Wiki), in particular the Room, Segment, Hotel, Cinema, Metro station, Steps, Star rating and Evaluation articles.
- GameFAQs guides by Aristotle47, kiwizoid, BStuart (Macintosh), strawhat and furdude2, linked from [the SimTower guide index](https://gamefaqs.gamespot.com/pc/565191-simtower/faqs/). Each is cited by author where a row depends on it.
- The official Maxis manual, the Windows Read Me and the Windows Help file, cited by name where a row depends on them.

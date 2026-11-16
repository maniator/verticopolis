---
app: minor
crate: minor
---
## Player
- Earning a new star now stops the game with a message box that shows the new rating and the rooms it opens, as the 1994 game did. In Modern the box also warns what the rating starts asking for, such as parking from three stars with the spaces your tower needs and has, and lists what the next rating needs.
## Engine
- The catalog publishes `rules.starDuties`, what each star rating starts asking of a tower as `{ star, id }` records (`star_duties::star_duties`), and `rules.announcesStarDuties` (`GameMode::announces_star_duties`, Modern only), catalog version 22. The ratings the duties begin at are named constants the rules read (`EMERGENCIES_FROM_STAR`, `VIP_VISITS_FROM_STAR`, `HOTEL_GUESTS_UNCOUNTED_FROM_STAR`, `BOMB_THREATS_FROM_STAR`), with no change in behavior.
## Contributors
- easterbunni on r/SimTower asked for a heads-up when the tower earns a star, after tenants left over parking the new rating needed.

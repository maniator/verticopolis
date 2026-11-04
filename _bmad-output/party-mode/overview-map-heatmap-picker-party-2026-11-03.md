# Party: where the heatmap picker lives (#343, 2026-11-03)

> **Superseded the same day** by the parity party (`overview-map-parity-party-2026-11-03.md`): the owner asked for the map's views in 3.0, and the picker moves onto the map as its tab row.
>
> **Snapshot, 2026-11-03.** Run on Opus at the owner's request. The live contract is `_bmad-output/specs/spec-overview-map/SPEC.md`.

Room: John (PM), Samus Shepard (game designer), Sally (UX), Amelia (dev), Grumbal (adversary), Boundary (edge cases).

On the table, from Naftali: "the map overlay option should only be on the minimap, no? Not in the sidebar."

What the game does today:
- The sidebar's "Map overlay" select tints every floor of the main tower view. Its modes are Congestion, Occupancy, Satisfaction and Housekeeping, and the legend is drawn at the view's top-left. The control's own tooltip calls it "like the original's evaluation maps".
- The approved plan renames it "Floor heatmap" in S5 and keeps it in the sidebar (decision 3).
- The retail MAP window has a row of four buttons (Edit, Eval, Pricing, Hotel). Each one recolors the map itself. That row is planned for 3.1.0 as #1617 (Hotel), #1618 (Eval) and #1619 (Pricing).

---

**Samus:** Naftali's instinct is the original's. In SimTower you read the tower's health off the little map: you click Eval and the map lights up red where tenants are unhappy. Nobody in 1994 painted the main view.

**Grumbal:** And we already shipped the other thing. Players have had a per-floor heatmap on the main view since 2.x. Pull it out of the sidebar in 3.0 and the first thing a returning player notices is a control that vanished.

**Sally:** On a phone it's worse than vanished. The map starts closed behind a pill, so a picker that lives only there sits two taps deep. And the card covers the legend's corner anyway.

**Boundary:** There's a mismatch underneath, too. The sidebar modes are per floor: congestion is a shaft budget, occupancy is a share of a floor. The original's tabs are per room: Eval colors each room by its score. They aren't the same views with a different home. Moving the select onto the map without changing what it draws gives you a minimap control that paints somewhere else.

**Amelia:** Which also means option two (move the select into the map's title bar, keep painting the main view) is the worst of both. It's a remote control in the wrong window. And `overviewMapWindow.ts` is at 499 lines, so it isn't free.

**John:** So option two is out. The real choice is now or 3.1.0 for minimap views.

**Grumbal:** 3.1.0. Minimap-only coloring is new drawing work, per-room data the map doesn't read yet, and for Pricing an engine export that doesn't exist. Pulling it into 3.0 breaks decision 1: no new scope that can slip the cut.

**Samus:** Fine, but don't let the sidebar picker become permanent by accident. When #1618 lands, Satisfaction and Eval are the same question asked twice, and so are Housekeeping and Hotel.

**Sally:** Then write that down where 3.1.0 will see it. When the map gets its tab row, that is the moment to decide whether the sidebar picker folds into it, on desktop at least, with phones keeping a way in.

**John:** Agreed in the room.

## Outcome

1. **3.0 keeps the picker in the sidebar**, renamed "Floor heatmap" in S5, painting the main view.
   - It is a shipped feature that players already use.
   - On a phone the map starts closed, so a map-only picker would be two taps away.
   - The per-floor heatmap and the original's per-room tabs draw different things.
2. **Moving the select into the Map window while it still paints the main view is rejected.** It would be a control in one window that changes another, and the window file is at its 500-line ceiling.
3. **Minimap-only views come in 3.1.0** as the original's tab row (#1617, #1618, #1619). Those issues now carry the follow-up question: once the tabs exist, does the sidebar picker fold into the map's tab row (at least on desktop, with a way in kept on phones)? The duplicates to resolve then are Satisfaction against Eval, and Housekeeping against Hotel.

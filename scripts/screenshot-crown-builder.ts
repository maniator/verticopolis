/**
 * The TOWER-rank capstone's top-out: extends the showcase hero tower
 * (`buildCanonTower`, floors 1-40) up to floor 100 and crowns it with the
 * wedding hall, (the scene frames the camera on the crown). Keep ERASABLE (no enums / namespaces).
 */

/** Run via page.evaluate after `buildCanonTower`. Throws when the hall is
 *  refused, so a rules change fails the capture instead of shipping a bare top. */
export function topOutTowerWithHall(): void {
  const g = (window as unknown as { game: any }).game;
  const s = g.sim;
  const W = g.grid.width;
  const cx = Math.floor(W / 2);
  const left = cx - 50;
  const right = left + 100;
  const HALL_FLOOR = 100;
  const HALL_WIDTH = 28;
  s.money = 1e12;
  // Slabs first: every story rests on the one below, so lay them bottom-up.
  for (let f = 41; f <= HALL_FLOOR; f++) for (let x = left; x < right; x++) s.tower.place("floor", f, x);
  // A sky lobby and an express shaft tie the new floors to the rest of the tower.
  // The hero tower's lower banks already hold some columns, so take the first
  // free one rather than hard-coding an x that a layout tweak would collide with.
  let express: { ok: boolean; reason?: string } = { ok: false, reason: "no free column" };
  for (let x = left + 2; x < right - 6 && !express.ok; x++) express = s.tower.placeTransport("elevatorExpress", x, 1, HALL_FLOOR);
  if (!express.ok) throw new Error(`crown express failed: ${express.reason}`);
  for (let f = 41; f < HALL_FLOOR; f++) {
    for (let x = left + 30; x + 1 <= right; ) {
      const r = s.tower.place("office", f, x);
      if (r.ok) {
        const u = s.tower.getUnit(r.unitId);
        u.state = "occupied";
        u.everOccupied = true;
        u.label = "Apex Holdings";
        x += u.width;
      } else x += 1;
    }
  }
  const hall = s.tower.place("weddingHall", HALL_FLOOR, cx - Math.floor(HALL_WIDTH / 2));
  if (!hall.ok) throw new Error(`crown wedding hall failed: ${hall.reason}`);
  s.tower.getUnit(hall.unitId).state = "occupied";
  s.evaluateStar();
  g.engine.setSim(g.enginePort.sim ? s : (g.syncSim(), g.renderSim));
  // Frozen so the capstone is byte-stable across regens.
  g.speed = 0;
  g.engine.paused = true;
}

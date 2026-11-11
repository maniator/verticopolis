import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { useTowerCatalogSource } from "../../catalog/towerCatalog";
import { readCatalog } from "../../dualrun/catalog";
import { createCardKit } from "../../game/cardKit";
import { newViewReader } from "../../game/portAccess";
import { swapDone } from "../../game/portLifecycle";
import type { EnginePort } from "../../simport/enginePort";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";
import {
  CARD_TEXT_CASES,
  CARD_TEXT_DIR,
  CARD_TEXT_MODES,
  cardTextFiles,
  expectRealLines,
  playCardTextCase,
  readCardTextFile,
  readCardTextGolden,
  textOf,
  writeCardTextGolden,
  type CardTextGolden,
} from "../goldens/cardText";
import { CARD_TEXT_WRITER, writeAfterPassingRun } from "../goldens/updateGate";

/**
 * The card-text sweep (#1561's canary): the inspector and editor lines the
 * shipped Rust-backed card prints for every room and shaft of a saved tower,
 * against the lines the TypeScript reference card printed for the same tower,
 * pinned in the card-text golden (`src/tests/goldens/cardText.ts`, #1806), room
 * by room, in card order. The facts tests (`conformanceWasmDiagnostics`) only
 * check lines a fact section names, so a line the reference drew with no fact
 * behind it (the shoppers-too-far line) slipped through; this compares the
 * text itself. A comparison as a set missed that the Rust card put a venue's
 * business block above its notice (the every-kind case puts a shop on notice,
 * a state only a save can hold, since play gives notice to lease tenants
 * alone).
 *
 * The engine, its catalog and the card are set up as the game sets them up:
 * the tower file goes through the engine's own `.vctower` loader, the catalog
 * is read from the engine with `readCatalog` (as `src/wasmhost/rustEngine.ts`
 * sets it), and the reader and card kit are the game's. Both cards read the
 * tower after the same play (`CARD_TEXT_PLAY_MINUTES`). It runs in
 * `npm run test:wasm`.
 *
 * The golden's lines came from the TypeScript reference card, which held
 * them to it until #1875 deleted that engine. A deliberate change to a card
 * line is a golden refresh, reviewed in the diff:
 * `VC_CARD_TEXT_UPDATE=rust npx vitest run --project integration cardTextParity`
 * rewrites the lines from the Rust card (the towers stay), only from a run in
 * which every test in this file ran and passed.
 */

const WRITING = CARD_TEXT_WRITER === "rust";
if (WRITING && !hasWasmPackage()) throw new Error("the card-text sweep needs the engine package (VC_CARD_TEXT_UPDATE=rust); run npm run wasm:build");

const fresh: CardTextGolden[] = [];
writeAfterPassingRun(
  "card-text lines",
  WRITING,
  () => CARD_TEXT_MODES.flatMap((m) => CARD_TEXT_CASES.filter((n) => !fresh.some((g) => g.mode === m && g.case === n)).map((n) => `${m}: ${n}`)),
  () => fresh.forEach(writeCardTextGolden),
);

type RustPort = EnginePort & { free(): void };

const roomsOf = (units: CardTextGolden["units"]) => units.map((u) => `${u.kind} #${u.id} on floor ${u.floor}`).sort();
const shaftsOf = (transports: readonly { readonly kind: string; readonly id: number }[]) => transports.map((t) => `${t.kind} #${t.id}`).sort();

describe("the card-text golden's files", () => {
  it("are a tower and its lines for every case and mode, and nothing else", () => {
    const want = cardTextFiles();
    expect(new Set(want).size, "two cases share a file name").toBe(want.length);
    expect(readdirSync(CARD_TEXT_DIR).sort()).toEqual([...want].sort());
  });
});

describe.skipIf(!hasWasmPackage())("the Rust card prints the lines the TypeScript card did", () => {
  for (const mode of CARD_TEXT_MODES) {
    for (const name of CARD_TEXT_CASES) {
      it(`${mode}: ${name}`, () => {
        const golden = readCardTextGolden(mode, name);
        expect([golden.mode, golden.case]).toEqual([mode, name]);
        const rust = wasm().Engine.newGame(1, "classic") as unknown as RustPort;
        try {
          useTowerCatalogSource(rust, (m) => readCatalog(wasm(), m));
          swapDone(rust, rust.loadVctower(readCardTextFile(mode, name)));
          playCardTextCase(name, (minutes) => rust.tick(minutes));
          const reader = newViewReader(rust);
          reader.update();
          const kit = createCardKit({ enginePort: rust, reader });
          // The engine holds the rooms and shafts the golden names, where it
          // names them, and no more.
          const live = reader.rooms.filter((r) => r.kind !== "floor" && r.kind !== "lobby");
          expect(live.map((r) => `${r.kind} #${r.id} on floor ${r.floor}`).sort()).toEqual(roomsOf(golden.units));
          expect(shaftsOf(reader.tower.transports)).toEqual(shaftsOf(golden.transports));

          const misses: string[] = [];
          const units = golden.units.map((u) => {
            const got = textOf(kit.diagnostics.unit(u.id, true));
            if (JSON.stringify(u.lines) !== JSON.stringify(got)) {
              misses.push(`${u.kind} #${u.id} floor ${u.floor}\n  golden: ${JSON.stringify(u.lines)}\n  Rust:   ${JSON.stringify(got)}`);
            }
            return { ...u, lines: got };
          });
          const transports = golden.transports.map((t) => {
            const got = textOf(kit.diagnostics.transport(t.id));
            if (JSON.stringify(t.lines) !== JSON.stringify(got)) misses.push(`${t.kind} #${t.id}\n  golden: ${JSON.stringify(t.lines)}\n  Rust:   ${JSON.stringify(got)}`);
            return { ...t, lines: got };
          });
          const printed: CardTextGolden = { case: name, mode, units, transports };
          expectRealLines(printed);
          if (WRITING) {
            fresh.push(printed);
            return;
          }
          expect(misses.slice(0, 6).join("\n")).toBe("");
        } finally {
          rust.free();
        }
      });
    }
  }
});

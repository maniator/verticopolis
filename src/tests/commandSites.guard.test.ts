import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { repoRel, sourceFiles } from "./guardFiles";
import { isTestFile } from "./importScan";

/**
 * Player commands reach the engine through the port (AD-9, facade slice 2):
 * the frontend sends `port.command()` and reads only its answer, so the
 * engine behind the port accepts or refuses each one. This guard fails when a
 * frontend file calls a command method on a simulation or tower again
 * (`sim.build(`, `getSim().tower.setStop(`, `simAtLoss?.emit(`,
 * `sim["addCar"](`, `sim.build.call(`), or writes one of the settings a
 * command owns (`sim.view =`, `tower.towerName =`, `sim.money -=`).
 *
 * It scans every non-test file under `src/` except the engine, the port
 * itself, the host, dual-run and save code and the test tree, the same
 * frontend the engine-import guard reads. It reads each file's syntax tree,
 * so comments and strings never count, and matches a receiver whose name
 * contains `sim` or is `tower` (a `getSim()` call included). A call through
 * some other alias or a destructured method is a review matter; this is a
 * tripwire for the common shapes.
 *
 * The lifecycle writes are slice 5's, which queues them on the port; they
 * are listed in {@link LIFECYCLE} by file and member, with how many each file
 * holds. The list only shrinks: a stale entry fails too, so it goes with the
 * write.
 */
const NOT_FRONTEND = ["src/engine/", "src/simport/", "src/tests/", "src/wasmhost/", "src/dualrun/", "src/storage/"] as const;

/** The instance's command methods, the port's commands and the raw edits
 *  behind them (tests and tooling only). */
const METHODS: ReadonlySet<string> = new Set([
  "build",
  "buildTransport",
  "removeFacility",
  "beginExtend",
  "extendTransport",
  "endExtend",
  "addCar",
  "removeCar",
  "setStop",
  "setExpressStops",
  "clearStops",
  "setSchedule",
  "setLabel",
  "adjustRent",
  "setNoRate",
  "priceUnit",
  "applyRentBatch",
  "setFilmPolicy",
  "rerollSubtype",
  "callExterminator",
  "resolveChoice",
  "toggleAutoBridge",
  "emit",
  "sellAt",
  "setCars",
  "resizeTransport",
  "removeUnit",
  "removeTransport",
  "place",
  "placeTransport",
]);

/** The settings a command owns, which the frontend never writes. */
const SETTINGS: ReadonlySet<string> = new Set(["towerName", "autoBridge", "view", "money"]);

/** Slice 5's lifecycle writes, as `file member` (a write as `member=`):
 *  - appBoot: the bulletin at boot when a save could not be read;
 *  - legacyImportAdopt: the bulletin an imported 1994 tower opens with;
 *  - saveLoad: the bulletin after a graphics reset is recovered, and the
 *    camera stamped onto the tower before an autosave or export;
 *  - appModals: the camera stamped before a manual slot save;
 *  - main.ts: the bridging preference an undo or redo restore keeps. */
const LIFECYCLE: ReadonlyMap<string, number> = new Map([
  ["src/game/appBoot.ts emit", 1],
  ["src/game/legacyImportAdopt.ts emit", 1],
  ["src/game/saveLoad.ts emit", 1],
  ["src/game/saveLoad.ts view=", 1],
  ["src/game/appModals.ts view=", 1],
  ["src/main.ts autoBridge=", 1],
]);

const RECEIVER = /^(?:[A-Za-z_$]*[Ss]im[A-Za-z_$0-9]*|tower)$/;

const ASSIGNMENTS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
]);

/** `x!`, `(x)` and `x as T` read as `x`. */
function bare(node: ts.Expression): ts.Expression {
  while (ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) node = node.expression;
  return node;
}

/** A member access's object and name: `a.b`, `a?.b` and `a["b"]`. */
function member(node: ts.Expression): { object: ts.Expression; name: string } | undefined {
  node = bare(node);
  if (ts.isPropertyAccessExpression(node)) return { object: node.expression, name: node.name.text };
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return { object: node.expression, name: node.argumentExpression.text };
  return undefined;
}

/** Whether `node` names a simulation or tower: `sim`, `app.sim`,
 *  `getSim()`, `this.deps.getSim().tower`. */
function isReceiver(node: ts.Expression): boolean {
  node = bare(node);
  if (ts.isCallExpression(node)) node = bare(node.expression);
  if (ts.isIdentifier(node)) return RECEIVER.test(node.text);
  const m = member(node);
  return m !== undefined && RECEIVER.test(m.name);
}

/** Every direct command call or settings write in `text`, counted as
 *  `file member` (a write as `file member=`). */
function scanText(rel: string, text: string): Map<string, number> {
  const found = new Map<string, number>();
  const bump = (key: string) => found.set(key, (found.get(key) ?? 0) + 1);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      let callee = member(node.expression);
      // `sim.build.call(sim, …)` and `.apply` / `.bind` call the method too.
      if (callee && (callee.name === "call" || callee.name === "apply" || callee.name === "bind")) callee = member(callee.object) ?? callee;
      if (callee && METHODS.has(callee.name) && isReceiver(callee.object)) bump(`${rel} ${callee.name}`);
    } else if (ts.isBinaryExpression(node) && ASSIGNMENTS.has(node.operatorToken.kind)) {
      const target = member(node.left);
      if (target && SETTINGS.has(target.name) && isReceiver(target.object)) bump(`${rel} ${target.name}=`);
    } else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
      const target = member(node.operand);
      if (target && SETTINGS.has(target.name) && isReceiver(target.object)) bump(`${rel} ${target.name}=`);
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true));
  return found;
}

function scan(): Map<string, number> {
  const found = new Map<string, number>();
  for (const abs of sourceFiles("src", [".ts"])) {
    const rel = repoRel(abs);
    if (NOT_FRONTEND.some((dir) => rel.startsWith(dir)) || isTestFile(rel)) continue;
    for (const [key, n] of scanText(rel, readFileSync(abs, "utf8"))) found.set(key, n);
  }
  return found;
}

describe("command sites", () => {
  it("sends every player command through the port, apart from slice 5's lifecycle writes", () => {
    const found = scan();
    const extra = [...found].filter(([key, n]) => n > (LIFECYCLE.get(key) ?? 0)).map(([key, n]) => `${key} (${n})`);
    expect(extra, "a frontend file calls a command on the simulation or tower; send it through port.command()").toEqual([]);
  });

  it("names no lifecycle write that is gone", () => {
    const found = scan();
    const stale = [...LIFECYCLE].filter(([key, n]) => (found.get(key) ?? 0) < n).map(([key]) => key);
    expect(stale, "a lifecycle write moved to the port; drop or lower its entry").toEqual([]);
  });

  it("catches the shapes it promises, and skips comments, strings and the port", () => {
    const sample = [
      "sim.build(kind, 2, 5);",
      "this.deps.getSim().tower.setStop(id, 2, false);",
      "simAtLoss?.emit(text);",
      "app.sim!.removeCar(1);",
      'sim["addCar"](1);',
      "sim.tower.setLabel.call(sim.tower, 1, 'x');",
      "(app.sim as Simulation).priceUnit(1, 2);",
      "app.sim.view = v;",
      "sim.tower.towerName = name;",
      "sim.money -= 5;",
      "sim.money++;",
      "app.sim.autoBridge ??= true;",
    ].join("\n");
    const hits = [...scanText("x.ts", sample)].map(([key, n]) => `${key.slice(5)}×${n}`);
    expect(hits).toEqual(["build×1", "setStop×1", "emit×1", "removeCar×1", "addCar×1", "setLabel×1", "priceUnit×1", "view=×1", "towerName=×1", "money=×2", "autoBridge=×1"]);
    const clean = [
      'app.port.command({ op: "build" });',
      "x.view == y;",
      "app.build.tryBuild(k);",
      "// sim.build(1);",
      "/* sim.tower.setStop(1, 2, false); */",
      '"sim.build(3)";',
      "const v = sim.view;",
    ].join("\n");
    expect([...scanText("x.ts", clean)]).toEqual([]);
  });
});

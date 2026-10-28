import { describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
import { TsEngine } from "../engine/port/tsEngine";
import { buildTDT } from "../storage/tdtExport";
import { exportReport } from "../storage/tdtExportReport";
import { importReport } from "../storage/tdtImportReport";
import { parseTDT } from "../storage/tdtParse";
import { exportInputs } from "../tests/fixtures/tdtExportCases";
import { importInputs } from "../tests/fixtures/tdtImportCases";
import { PortCodes } from "./portCodes";
import { exportFacts, importFacts } from "./tdtRecords";

const bufferOf = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

describe("the .TDT reports from the port's records", () => {
  it("reads every import case's record back as the report parseTDT builds", () => {
    let read = 0;
    for (const [id, bytes, filename = "TOWER.TDT"] of importInputs()) {
      const engine = new TsEngine(Simulation.newGame(1));
      const rec = engine.loadTdt(bytes, filename);
      if (rec[0] !== 1) continue;
      read++;
      const want = parseTDT(bufferOf(bytes), filename).report;
      expect(importReport(importFacts(rec, new PortCodes(engine), engine)), id).toEqual(want);
    }
    expect(read).toBeGreaterThan(10);
  });

  it("reads every export case's record back as the report buildTDT builds", () => {
    let read = 0;
    for (const [id, input] of exportInputs()) {
      if (!("save" in input)) continue;
      const engine = new TsEngine(Simulation.deserialize(input.save));
      const rec = engine.tdtExport();
      if (rec[0] !== 1) continue;
      read++;
      const want = buildTDT(engine.sim.serialize()).report;
      expect(exportReport(exportFacts(rec, new PortCodes(engine), engine.towerName())), id).toEqual(want);
    }
    expect(read).toBeGreaterThan(5);
  });
});

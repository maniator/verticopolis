import { describe, expect, it } from "vitest";
import { arrivalLine } from "./arrivalLine";

/** A stand-in for the reader: only the room and structure counts and the name matter. */
const sim = (towerName: string, built: boolean) =>
  ({ rooms: built ? [{}] : [], structure: built ? [{}] : [], tower: { towerName } }) as unknown as Parameters<
    typeof arrivalLine
  >[0];

describe("arrivalLine", () => {
  it("names a loaded tower, welcomes back a reloaded one, and opens a new empty lot", () => {
    expect(arrivalLine(sim("Skyspire", true), "entered")).toBe("Loaded Skyspire.");
    expect(arrivalLine(sim("Skyspire", true), "returned")).toBe("Welcome back to Skyspire.");
    expect(arrivalLine(sim("Skyspire", false), "entered")).toBe("Skyspire is open for business.");
  });

  it("says your tower when the name is blank, and keeps a name with markup as plain text", () => {
    expect(arrivalLine(sim("  ", true), "entered")).toBe("Loaded your tower.");
    expect(arrivalLine(sim("", false), "returned")).toBe("Your tower is open for business.");
    expect(arrivalLine(sim("<b>x</b>", true), "entered")).toBe("Loaded <b>x</b>.");
  });
});

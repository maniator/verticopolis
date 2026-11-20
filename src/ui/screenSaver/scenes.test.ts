import { describe, it, expect } from "vitest";
import { asCtx, ctxDouble, seq } from "./saverTestKit.fixture";
import { NIGHT } from "./saverScene";
import { bulletinMarquee, expressElevators, skylineStarfield } from "./skyScenes";
import { endlessTower, madeUpTower, nightShift, type TowerSnapshot } from "./towerScenes";

const tower: TowerSnapshot = {
  structure: [
    { floor: 0, x: 0, width: 20 },
    { floor: 1, x: 0, width: 20 },
  ],
  rooms: [
    { floor: 1, x: 0, width: 6, color: "#bfe0ff", lit: true },
    { floor: 1, x: 7, width: 6, color: "#ffc94a", lit: false },
  ],
  shafts: [{ x: 14, width: 4, bottom: 0, top: 1 }],
};

describe("Night Shift", () => {
  it("paints the tower onto its layer once and copies the layer every frame", () => {
    const layer = ctxDouble();
    const c = ctxDouble();
    const scene = nightShift(80, 60, tower, seq(0.5), () => asCtx(layer));
    const paintedAtStart = layer.fillRect.mock.calls.length;
    expect(paintedAtStart).toBeGreaterThan(0);
    scene.draw(asCtx(c));
    scene.draw(asCtx(c));
    expect(c.drawImage).toHaveBeenCalledTimes(2);
    expect(c.drawImage).toHaveBeenCalledWith(layer.canvas, 0, 0);
    expect(layer.canvas).toEqual({ width: 80, height: 60 });
    // Drawing a frame never repaints the whole tower onto the layer.
    expect(layer.fillRect.mock.calls.length).toBe(paintedAtStart);
  });

  it("switches a window by repainting only that window", () => {
    const layer = ctxDouble();
    const scene = nightShift(80, 60, tower, seq(0), () => asCtx(layer));
    const before = layer.fillRect.mock.calls.length;
    scene.step(1); // at least one switch a second
    expect(layer.fillRect.mock.calls.length).toBe(before + 1);
  });

  it("paints the tower straight onto the frame when no layer can be made", () => {
    const c = ctxDouble();
    const scene = nightShift(80, 60, tower, seq(0.5));
    scene.draw(asCtx(c));
    expect(c.drawImage).not.toHaveBeenCalled();
    expect(c.fillRect).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("makes a tower up for a player with no rooms yet", () => {
    const c = ctxDouble();
    const layer = ctxDouble();
    nightShift(80, 60, { structure: [], rooms: [], shafts: [] }, seq(0.3, 0.7), () => asCtx(layer)).draw(asCtx(c));
    expect(layer.fillRect.mock.calls.length).toBeGreaterThan(30);
    expect(madeUpTower(seq(0.3, 0.7)).rooms.length).toBeGreaterThan(0);
  });
});

describe("Endless Tower", () => {
  it("lays rooms as time passes and draws them", () => {
    const scene = endlessTower(80, 60, seq(0.4, 0.6));
    const first = ctxDouble();
    scene.draw(asCtx(first));
    scene.step(0.5);
    const later = ctxDouble();
    scene.draw(asCtx(later));
    expect(later.fillRect.mock.calls.length).toBeGreaterThan(first.fillRect.mock.calls.length);
  });
});

describe("the sky scenes", () => {
  it("Skyline Starfield and Express Elevators draw a night sky and move", () => {
    for (const make of [skylineStarfield, expressElevators]) {
      const scene = make(80, 60, seq(0.2, 0.8, 0.5));
      const c = ctxDouble();
      scene.step(0.1);
      scene.draw(asCtx(c));
      expect(c.fillRect.mock.calls[0]).toEqual([0, 0, 80, 60]);
      expect(c.fillRect.mock.calls.length).toBeGreaterThan(5);
    }
  });

  it("Bulletin Marquee shows its first line on screen and measures each line once", () => {
    const scene = bulletinMarquee(100, 60, ["One.", "Two."], seq(0.5));
    const c = ctxDouble();
    scene.draw(asCtx(c));
    const x = c.fillText.mock.calls[0][1] as number;
    expect(c.fillText.mock.calls[0][0]).toBe("One.");
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(100);
    scene.step(0.05);
    scene.draw(asCtx(c));
    expect(c.measureText).toHaveBeenCalledTimes(1);
    // Run the first line off the left edge: the next line comes in.
    for (let i = 0; i < 100; i++) scene.step(0.1);
    scene.draw(asCtx(c));
    expect(c.fillText.mock.calls[c.fillText.mock.calls.length - 1][0]).toBe("Two.");
  });

  it("Bulletin Marquee has a line even with none handed in", () => {
    const c = ctxDouble();
    bulletinMarquee(100, 60, [], seq(0.5)).draw(asCtx(c));
    expect(c.fillText.mock.calls[0][0]).toBe("Verticopolis");
    expect(c.fillStyle).not.toBe(NIGHT.sky);
  });
});

describe("Endless Tower's layer", () => {
  it("paints each room once as it is laid and copies the layer every frame", () => {
    const layer = ctxDouble();
    const scene = endlessTower(80, 60, seq(0.4, 0.6), () => asCtx(layer));
    expect(layer.canvas).toEqual({ width: 80, height: 60 });
    scene.step(0.5);
    const painted = layer.fillRect.mock.calls.length;
    expect(painted).toBeGreaterThan(5);
    const c = ctxDouble();
    scene.draw(asCtx(c));
    scene.draw(asCtx(c));
    // Two frames copy the layer and repaint nothing on it.
    expect(c.drawImage).toHaveBeenCalledTimes(2);
    expect(layer.fillRect.mock.calls.length).toBe(painted);
    // A frame's own draws stay a handful (sky, ground, shafts, crane),
    // however many rooms are laid.
    expect(c.fillRect.mock.calls.length).toBeLessThan(20);
  });

  it("clears the layer when a new tower starts", () => {
    const layer = ctxDouble();
    const scene = endlessTower(40, 30, seq(0.4, 0.6), () => asCtx(layer));
    for (let i = 0; i < 200; i++) scene.step(0.1);
    expect(layer.clearRect.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("Night Shift's sky", () => {
  it("is made once and reused every frame", () => {
    const c = ctxDouble();
    const scene = nightShift(80, 60, tower, seq(0.5), () => asCtx(ctxDouble()));
    scene.draw(asCtx(c));
    scene.draw(asCtx(c));
    scene.draw(asCtx(c));
    expect(c.createLinearGradient).toHaveBeenCalledTimes(1);
  });
});

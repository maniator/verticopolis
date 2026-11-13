import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("tone", async () => (await import("./toneRecordingMock")).toneMock());

import { contextSwaps, graph, resetToneFaults, type NodeRec } from "./toneRecordingMock";
import { usePlaybackContext } from "./toneContext";

describe("usePlaybackContext", () => {
  beforeEach(() => {
    graph.nodes.length = 0;
    resetToneFaults();
  });

  it("plays through one playback-latency context and closes the one Tone held before", () => {
    usePlaybackContext();
    expect(contextSwaps).toHaveLength(1);
    const playback = (contextSwaps[0].context as { __rec: NodeRec }).__rec;
    expect(playback.kind).toBe("Context");
    expect(playback.args[0]).toEqual({ latencyHint: "playback" });
    expect(playback.disposed).toBe(false);
    // The context Tone held before the swap (its import-time default) is closed.
    const before = graph.nodes.slice(0, graph.nodes.indexOf(playback)).filter((n) => n.kind === "Context");
    expect(before).toHaveLength(1);
    expect(before[0].disposed).toBe(true);
  });
});

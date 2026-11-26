import { describe, it, expect } from "vitest";
import {
  CONFETTI_PIECE_COUNT,
  celebrationPath,
  confettiPieces,
  fallLengthMs,
  hasCelebrationSignal,
  shouldCelebrate,
  withoutCelebrationSignal,
} from "../index";

const signalled = () =>
  new URL(celebrationPath("/x"), "http://localhost").searchParams;

describe("celebrationPath", () => {
  it("adds the one-time celebrate signal to a path", () => {
    expect(celebrationPath("/courses/tailwind/welcome")).toBe(
      "/courses/tailwind/welcome?celebrate=1"
    );
  });

  it("produces a URL that shouldCelebrate recognises", () => {
    expect(shouldCelebrate(signalled(), false)).toBe(true);
  });
});

describe("hasCelebrationSignal", () => {
  it("sees the signal whatever its value", () => {
    expect(hasCelebrationSignal(signalled())).toBe(true);
    expect(hasCelebrationSignal(new URLSearchParams("celebrate=0"))).toBe(true);
  });

  it("sees nothing on a plain visit", () => {
    expect(hasCelebrationSignal(new URLSearchParams("tab=1"))).toBe(false);
  });
});

describe("withoutCelebrationSignal", () => {
  it("drops the signal and keeps every other parameter", () => {
    const params = new URLSearchParams("tab=notes&celebrate=1");
    const stripped = withoutCelebrationSignal(params);
    expect(hasCelebrationSignal(stripped)).toBe(false);
    expect(stripped.toString()).toBe("tab=notes");
  });
});

describe("shouldCelebrate", () => {
  it("stays calm on a plain visit", () => {
    expect(shouldCelebrate(new URLSearchParams(), false)).toBe(false);
  });

  it("stays calm when the signal has another value", () => {
    expect(shouldCelebrate(new URLSearchParams("celebrate=0"), false)).toBe(
      false
    );
  });

  it("respects prefers-reduced-motion", () => {
    expect(shouldCelebrate(signalled(), true)).toBe(false);
  });
});

describe("confettiPieces", () => {
  it("makes the full burst of pieces", () => {
    expect(confettiPieces(fixed(0.5))).toHaveLength(CONFETTI_PIECE_COUNT);
  });

  it("maps the lowest random value to the low end of every range", () => {
    expect(confettiPieces(fixed(0))[0]).toEqual({
      id: 0,
      leftPercent: 0,
      delayMs: 0,
      durationMs: 2200,
      driftPx: -120,
      spinDeg: 360,
      sizePx: 6,
      color: "#f43f5e",
    });
  });

  it("maps the highest random value to the high end of every range", () => {
    expect(confettiPieces(fixed(1))[0]).toEqual({
      id: 0,
      leftPercent: 100,
      delayMs: 600,
      durationMs: 3600,
      driftPx: 120,
      spinDeg: 1080,
      sizePx: 12,
      color: "#f43f5e",
    });
  });

  it("gives every piece its own id", () => {
    const ids = confettiPieces(fixed(0.5)).map((p) => p.id);
    expect(ids.slice(0, 3)).toEqual([0, 1, 2]);
    expect(new Set(ids).size).toBe(CONFETTI_PIECE_COUNT);
  });

  it("cycles through the palette", () => {
    const colors = confettiPieces(fixed(0.5))
      .slice(0, 7)
      .map((p) => p.color);
    expect(colors).toEqual([
      "#f43f5e",
      "#f59e0b",
      "#10b981",
      "#3b82f6",
      "#8b5cf6",
      "#ec4899",
      "#f43f5e",
    ]);
  });

  it("rounds timings and sizes to whole numbers", () => {
    const [piece] = confettiPieces(fixed(0.3333));
    expect(piece.delayMs).toBe(200);
    expect(piece.durationMs).toBe(2667);
    expect(piece.driftPx).toBe(-40);
    expect(piece.spinDeg).toBe(600);
    expect(piece.sizePx).toBe(8);
    expect(piece.leftPercent).toBeCloseTo(33.33);
  });
});

describe("fallLengthMs", () => {
  it("lasts until the latest piece has landed", () => {
    const [early, late] = confettiPieces(fixed(0)).slice(0, 2);
    expect(
      fallLengthMs([
        { ...early, delayMs: 100, durationMs: 2000 },
        { ...late, delayMs: 500, durationMs: 3000 },
      ])
    ).toBe(3500);
  });

  it("is over at once when there is nothing to fall", () => {
    expect(fallLengthMs([])).toBe(0);
  });
});

function fixed(value: number) {
  return () => value;
}

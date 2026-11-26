import { describe, it, expect } from "vitest";
import {
  CELEBRATE_PARAM,
  CONFETTI_PIECE_COUNT,
  celebrationPath,
  confettiPieces,
  shouldCelebrate,
} from "../index";

describe("celebrationPath", () => {
  it("adds the one-time celebrate signal to a path", () => {
    expect(celebrationPath("/courses/tailwind/welcome")).toBe(
      "/courses/tailwind/welcome?celebrate=1"
    );
  });

  it("produces a URL that shouldCelebrate recognises", () => {
    const url = new URL(celebrationPath("/x"), "http://localhost");
    expect(shouldCelebrate(url.searchParams, false)).toBe(true);
  });
});

describe("shouldCelebrate", () => {
  it("celebrates when the signal is present", () => {
    expect(
      shouldCelebrate(new URLSearchParams(`${CELEBRATE_PARAM}=1`), false)
    ).toBe(true);
  });

  it("stays calm on a plain visit", () => {
    expect(shouldCelebrate(new URLSearchParams(), false)).toBe(false);
  });

  it("stays calm when the signal has another value", () => {
    expect(shouldCelebrate(new URLSearchParams("celebrate=0"), false)).toBe(
      false
    );
  });

  it("respects prefers-reduced-motion", () => {
    expect(shouldCelebrate(new URLSearchParams("celebrate=1"), true)).toBe(
      false
    );
  });
});

describe("confettiPieces", () => {
  const fixed = (value: number) => () => value;

  it("makes the default number of pieces", () => {
    expect(confettiPieces(fixed(0.5))).toHaveLength(CONFETTI_PIECE_COUNT);
  });

  it("makes as many pieces as asked, never fewer than none", () => {
    expect(confettiPieces(fixed(0.5), 3)).toHaveLength(3);
    expect(confettiPieces(fixed(0.5), 2.9)).toHaveLength(2);
    expect(confettiPieces(fixed(0.5), -4)).toHaveLength(0);
  });

  it("maps the lowest random value to the low end of every range", () => {
    expect(confettiPieces(fixed(0), 1)[0]).toEqual({
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
    expect(confettiPieces(fixed(1), 1)[0]).toEqual({
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
    expect(confettiPieces(fixed(0.5), 3).map((p) => p.id)).toEqual([0, 1, 2]);
  });

  it("cycles through the palette", () => {
    const colors = confettiPieces(fixed(0.5), 7).map((p) => p.color);
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
    const [piece] = confettiPieces(fixed(0.3333), 1);
    expect(piece.delayMs).toBe(200);
    expect(piece.durationMs).toBe(2667);
    expect(piece.driftPx).toBe(-40);
    expect(piece.spinDeg).toBe(600);
    expect(piece.sizePx).toBe(8);
    expect(piece.leftPercent).toBeCloseTo(33.33);
  });
});

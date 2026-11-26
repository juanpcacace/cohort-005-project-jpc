export type ConfettiPiece = {
  id: number;
  leftPercent: number;
  delayMs: number;
  durationMs: number;
  driftPx: number;
  spinDeg: number;
  sizePx: number;
  color: string;
};

export const CONFETTI_COLORS = [
  "#f43f5e",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
] as const;

function between(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}

export function makePieces(
  count: number,
  random: () => number
): ConfettiPiece[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    leftPercent: between(random, 0, 100),
    delayMs: Math.round(between(random, 0, 600)),
    durationMs: Math.round(between(random, 2200, 3600)),
    driftPx: Math.round(between(random, -120, 120)),
    spinDeg: Math.round(between(random, 360, 1080)),
    sizePx: Math.round(between(random, 6, 12)),
    color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
  }));
}

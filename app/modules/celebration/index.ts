/**
 * The one-time signal a purchase or seat redemption puts on its redirect.
 * The page removes it after celebrating, so a refresh or a later visit to
 * the same page stays calm.
 */
const CELEBRATE_PARAM = "celebrate";

export function celebrationPath(path: string): string {
  return `${path}?${CELEBRATE_PARAM}=1`;
}

export function hasCelebrationSignal(searchParams: URLSearchParams): boolean {
  return searchParams.has(CELEBRATE_PARAM);
}

export function shouldCelebrate(
  searchParams: URLSearchParams,
  prefersReducedMotion: boolean
): boolean {
  return searchParams.get(CELEBRATE_PARAM) === "1" && !prefersReducedMotion;
}

export function withoutCelebrationSignal(
  searchParams: URLSearchParams
): URLSearchParams {
  searchParams.delete(CELEBRATE_PARAM);
  return searchParams;
}

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

export const CONFETTI_PIECE_COUNT = 80;

const CONFETTI_COLORS = [
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

export function confettiPieces(
  random: () => number = Math.random
): ConfettiPiece[] {
  return Array.from({ length: CONFETTI_PIECE_COUNT }, (_, index) => ({
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

export function fallLengthMs(pieces: ConfettiPiece[]): number {
  return Math.max(0, ...pieces.map((p) => p.delayMs + p.durationMs));
}

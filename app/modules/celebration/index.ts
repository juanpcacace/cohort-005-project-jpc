import { makePieces, type ConfettiPiece } from "./lib/confetti";

export type { ConfettiPiece };

/**
 * The one-time signal a purchase or seat redemption puts on its redirect.
 * The page removes it after celebrating, so a refresh or a later visit to
 * the same page stays calm.
 */
export const CELEBRATE_PARAM = "celebrate";

export function celebrationPath(path: string): string {
  return `${path}?${CELEBRATE_PARAM}=1`;
}

export function shouldCelebrate(
  searchParams: URLSearchParams,
  prefersReducedMotion: boolean
): boolean {
  return searchParams.get(CELEBRATE_PARAM) === "1" && !prefersReducedMotion;
}

export const CONFETTI_PIECE_COUNT = 80;

export function confettiPieces(
  random: () => number = Math.random,
  count: number = CONFETTI_PIECE_COUNT
): ConfettiPiece[] {
  return makePieces(Math.max(0, Math.floor(count)), random);
}

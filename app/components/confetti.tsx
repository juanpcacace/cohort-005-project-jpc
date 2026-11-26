import { useEffect, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router";
import {
  CELEBRATE_PARAM,
  confettiPieces,
  shouldCelebrate,
  type ConfettiPiece,
} from "~/modules/celebration";

const LONGEST_FALL_MS = 4500;

/**
 * Rains confetti once when the page was reached through a purchase or seat
 * redemption redirect, then drops the signal from the URL.
 */
export function PurchaseConfetti() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [pieces, setPieces] = useState<ConfettiPiece[]>([]);

  useEffect(() => {
    if (searchParams.get(CELEBRATE_PARAM) === null) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (shouldCelebrate(searchParams, reducedMotion)) {
      setPieces(confettiPieces());
    }
    setSearchParams(
      (prev) => {
        prev.delete(CELEBRATE_PARAM);
        return prev;
      },
      { replace: true }
    );
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (pieces.length === 0) return;
    const timer = window.setTimeout(() => setPieces([]), LONGEST_FALL_MS);
    return () => window.clearTimeout(timer);
  }, [pieces]);

  if (pieces.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      data-testid="purchase-confetti"
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
    >
      {pieces.map((piece) => (
        <FallingPiece key={piece.id} piece={piece} />
      ))}
    </div>
  );
}

function FallingPiece({ piece }: { piece: ConfettiPiece }) {
  const style = {
    left: `${piece.leftPercent}%`,
    width: `${piece.sizePx}px`,
    height: `${piece.sizePx * 0.4}px`,
    backgroundColor: piece.color,
    "--confetti-delay": `${piece.delayMs}ms`,
    "--confetti-duration": `${piece.durationMs}ms`,
    "--confetti-drift": `${piece.driftPx}px`,
    "--confetti-spin": `${piece.spinDeg}deg`,
  } as CSSProperties;
  return <span className="confetti-piece rounded-[2px]" style={style} />;
}

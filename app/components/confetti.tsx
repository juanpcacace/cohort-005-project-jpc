import { useEffect, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router";
import {
  confettiPieces,
  fallLengthMs,
  hasCelebrationSignal,
  shouldCelebrate,
  withoutCelebrationSignal,
  type ConfettiPiece,
} from "~/modules/celebration";

const PIECE_HEIGHT_TO_WIDTH = 0.4;

export function CelebrationConfetti() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [pieces, setPieces] = useState<ConfettiPiece[]>([]);

  useEffect(() => {
    if (!hasCelebrationSignal(searchParams)) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (shouldCelebrate(searchParams, reducedMotion)) {
      setPieces(confettiPieces());
    }
    setSearchParams(withoutCelebrationSignal, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (pieces.length === 0) return;
    const timer = window.setTimeout(() => setPieces([]), fallLengthMs(pieces));
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
    height: `${piece.sizePx * PIECE_HEIGHT_TO_WIDTH}px`,
    backgroundColor: piece.color,
    "--confetti-delay": `${piece.delayMs}ms`,
    "--confetti-duration": `${piece.durationMs}ms`,
    "--confetti-drift": `${piece.driftPx}px`,
    "--confetti-spin": `${piece.spinDeg}deg`,
  } as CSSProperties;
  return <span className="confetti-piece rounded-[2px]" style={style} />;
}

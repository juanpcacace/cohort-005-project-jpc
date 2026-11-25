import { noteDraft as describe } from "./lib/draft";
import type { NoteDraft, NoteDraftInput } from "./lib/draft";

export type { NoteDraft, NoteDraftInput, NoteStatus } from "./lib/draft";

/**
 * What the lesson's note box should show for the text in it: the character
 * count against the limit, whether Save is worth pressing, and one status.
 */
export function noteDraft(input: NoteDraftInput): NoteDraft {
  return describe(input);
}

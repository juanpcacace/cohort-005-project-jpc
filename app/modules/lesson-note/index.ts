import { MAX_NOTE_LENGTH } from "~/lib/notes";

export type NoteDraftInput = {
  /** What is in the box right now. */
  draft: string;
  /** The body last saved, or null before the first save. */
  savedBody: string | null;
  saving: boolean;
  /** The error the last save returned, if it failed. */
  error?: string;
};

export type NoteStatus =
  | { kind: "saving" }
  | { kind: "error"; message: string }
  | { kind: "too-long" }
  | { kind: "unsaved" }
  | { kind: "saved" }
  | { kind: "empty" };

export type NoteDraft = {
  length: number;
  max: number;
  tooLong: boolean;
  canSave: boolean;
  status: NoteStatus;
};

function statusOf(
  input: NoteDraftInput,
  dirty: boolean,
  tooLong: boolean
): NoteStatus {
  if (input.saving) return { kind: "saving" };
  if (tooLong) return { kind: "too-long" };
  if (input.error) return { kind: "error", message: input.error };
  if (dirty) return { kind: "unsaved" };
  if (input.savedBody !== null) return { kind: "saved" };
  return { kind: "empty" };
}

/**
 * What the lesson's note box should show for the text in it: the character
 * count against the limit, whether Save is worth pressing, and one status.
 */
export function noteDraft(input: NoteDraftInput): NoteDraft {
  const length = input.draft.length;
  const tooLong = length > MAX_NOTE_LENGTH;
  // The server trims before it saves, so trailing space is not an edit.
  const dirty = input.draft.trim() !== (input.savedBody ?? "");
  const blank = input.draft.trim().length === 0;

  return {
    length,
    max: MAX_NOTE_LENGTH,
    tooLong,
    canSave: dirty && !blank && !tooLong && !input.saving,
    status: statusOf(input, dirty, tooLong),
  };
}

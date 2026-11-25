import { describe, it, expect } from "vitest";
import { noteDraft } from "../index";
import { MAX_NOTE_LENGTH } from "~/lib/notes";

const base = { draft: "", savedBody: null, saving: false };

describe("noteDraft", () => {
  it("is empty, and cannot be saved, before anything is written", () => {
    const draft = noteDraft(base);
    expect(draft.status).toEqual({ kind: "empty" });
    expect(draft.canSave).toBe(false);
    expect(draft.length).toBe(0);
    expect(draft.max).toBe(MAX_NOTE_LENGTH);
  });

  it("is unsaved, and can be saved, once the Student types", () => {
    const draft = noteDraft({ ...base, draft: "Unions need a tag" });
    expect(draft.status).toEqual({ kind: "unsaved" });
    expect(draft.canSave).toBe(true);
    expect(draft.length).toBe(17);
  });

  it("is saved when the box matches the saved note", () => {
    const draft = noteDraft({ ...base, draft: "Hi", savedBody: "Hi" });
    expect(draft.status).toEqual({ kind: "saved" });
    expect(draft.canSave).toBe(false);
  });

  it("ignores surrounding whitespace, which the server trims", () => {
    const draft = noteDraft({ ...base, draft: "Hi \n", savedBody: "Hi" });
    expect(draft.status).toEqual({ kind: "saved" });
  });

  it("is unsaved when the box differs from the saved note", () => {
    const draft = noteDraft({ ...base, draft: "Hi there", savedBody: "Hi" });
    expect(draft.status).toEqual({ kind: "unsaved" });
    expect(draft.canSave).toBe(true);
  });

  it("cannot save whitespace alone", () => {
    expect(noteDraft({ ...base, draft: "   " }).canSave).toBe(false);

    const cleared = noteDraft({ ...base, draft: "   ", savedBody: "Hi" });
    expect(cleared.status).toEqual({ kind: "unsaved" });
    expect(cleared.canSave).toBe(false);
  });

  it("allows exactly the limit, and not one character over", () => {
    const atLimit = noteDraft({ ...base, draft: "a".repeat(MAX_NOTE_LENGTH) });
    expect(atLimit.tooLong).toBe(false);
    expect(atLimit.canSave).toBe(true);

    const over = noteDraft({ ...base, draft: "a".repeat(MAX_NOTE_LENGTH + 1) });
    expect(over.tooLong).toBe(true);
    expect(over.canSave).toBe(false);
    expect(over.status).toEqual({ kind: "too-long" });
  });

  it("is saving while the save is in flight, and cannot save again", () => {
    const draft = noteDraft({ ...base, draft: "Hi", saving: true });
    expect(draft.status).toEqual({ kind: "saving" });
    expect(draft.canSave).toBe(false);
  });

  it("reports the error the last save returned", () => {
    const draft = noteDraft({ ...base, draft: "Hi", error: "Nope" });
    expect(draft.status).toEqual({ kind: "error", message: "Nope" });
  });

  it("reports too-long ahead of a stale error", () => {
    const draft = noteDraft({
      ...base,
      draft: "a".repeat(MAX_NOTE_LENGTH + 1),
      error: "Nope",
    });
    expect(draft.status).toEqual({ kind: "too-long" });
  });
});

import { useState } from "react";
import { useFetcher } from "react-router";
import { Check, Lock, NotebookPen } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Textarea } from "~/components/ui/textarea";
import { cn, formatRelativeTime } from "~/lib/utils";
import {
  noteDraft,
  type NoteDraft,
  type NoteStatus,
} from "~/modules/lesson-note";

// Styled to match the Questions & Discussion card further down the page, so
// the two places a Student writes look like one family.
export function LessonNote({
  note,
}: {
  note: { body: string; updatedAt: string } | null;
}) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const [body, setBody] = useState(note?.body ?? "");
  const draft = noteDraft({
    draft: body,
    savedBody: note?.body ?? null,
    saving: fetcher.state !== "idle",
    error: fetcher.data?.error,
  });

  return (
    <Card className="mb-8 gap-0 py-0">
      <CardContent className="p-6">
        <NoteHeader />

        <fetcher.Form method="post" className="space-y-2">
          <input type="hidden" name="intent" value="save-note" />
          <Textarea
            name="body"
            rows={4}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Write down what you want to remember from this lesson..."
            aria-label="Your notes"
            className="resize-y"
          />
          <NoteFooter draft={draft} updatedAt={note?.updatedAt} />
        </fetcher.Form>
      </CardContent>
    </Card>
  );
}

function NoteStatusText({
  status,
  updatedAt,
}: {
  status: NoteStatus;
  updatedAt: string | undefined;
}) {
  switch (status.kind) {
    case "error":
      return <span className="text-xs text-destructive">{status.message}</span>;
    case "too-long":
      return (
        <span className="text-xs text-destructive">
          Too long to save. Shorten your note.
        </span>
      );
    case "unsaved":
      return (
        <span className="text-xs text-muted-foreground">Unsaved changes</span>
      );
    case "saved":
      return (
        <span
          suppressHydrationWarning
          className="flex items-center gap-1 text-xs text-muted-foreground"
        >
          <Check className="size-3" />
          Saved {updatedAt ? formatRelativeTime(updatedAt) : ""}
        </span>
      );
    default:
      return null;
  }
}

function NoteHeader() {
  return (
    <div className="mb-4 flex items-center gap-2">
      <NotebookPen className="size-5 text-primary" />
      <h2 className="text-xl font-semibold">Your notes</h2>
      <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
        <Lock className="size-3" />
        Only you can see these
      </span>
    </div>
  );
}

function NoteFooter({
  draft,
  updatedAt,
}: {
  draft: NoteDraft;
  updatedAt: string | undefined;
}) {
  return (
    <div className="flex items-center gap-3">
      <Button type="submit" size="sm" disabled={!draft.canSave}>
        {draft.status.kind === "saving" ? "Saving..." : "Save note"}
      </Button>
      <NoteStatusText status={draft.status} updatedAt={updatedAt} />
      <span
        className={cn(
          "ml-auto text-xs",
          draft.tooLong ? "text-destructive" : "text-muted-foreground"
        )}
      >
        {draft.length} / {draft.max}
      </span>
    </div>
  );
}

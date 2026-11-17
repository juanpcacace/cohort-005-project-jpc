import { describe, it, expect } from "vitest";
import { toFeedRow, toSnippet } from "./notifications";

describe("toFeedRow", () => {
  it("writes a Discussion Reply row that links to the reply on its lesson", () => {
    const row = toFeedRow({
      id: "m1",
      kind: "discussion-reply",
      actor: { name: "Ada", avatarUrl: "https://example.com/ada.png" },
      data: {
        commentId: 42,
        questionId: 7,
        lessonId: 3,
        lessonTitle: "Closures",
        courseSlug: "js-basics",
        snippet: "Because scope.",
      },
      sentAt: "2026-10-06T12:00:00.000Z",
      seen: true,
      read: false,
    });

    expect(row).toEqual({
      id: "m1",
      kind: "discussion-reply",
      topic: "discussion-replies",
      actor: { name: "Ada", avatarUrl: "https://example.com/ada.png" },
      title: "Ada replied to your question",
      snippet: "Because scope.",
      link: "/courses/js-basics/lessons/3#comment-42",
      sentAt: "2026-10-06T12:00:00.000Z",
      seen: true,
      read: false,
    });
  });
});

describe("toSnippet", () => {
  it("drops markdown and keeps one line", () => {
    expect(
      toSnippet("**Bold** and `code`\n\n> quoted [link](https://x.dev)")
    ).toBe("Bold and code quoted link");
  });

  it("cuts long text with an ellipsis", () => {
    const snippet = toSnippet("word ".repeat(100));

    expect(snippet.length).toBeLessThanOrEqual(140);
    expect(snippet.endsWith("…")).toBe(true);
  });
});

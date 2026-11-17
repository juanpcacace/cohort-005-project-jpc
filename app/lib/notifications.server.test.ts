import { describe, it, expect } from "vitest";
import { noopProvider } from "./notifications.server";

describe("noopProvider (no KNOCK_SECRET_API_KEY)", () => {
  it("logs a send and keeps the Feed empty", async () => {
    const logged: string[] = [];
    const provider = noopProvider((message) => logged.push(message));

    await provider.send({
      kind: "discussion-reply",
      recipients: [{ id: 1, name: "Ada", email: "ada@example.com", avatarUrl: null }],
      actor: null,
      data: {
        commentId: 2,
        questionId: 1,
        lessonId: 1,
        lessonTitle: "Closures",
        courseSlug: "js",
        snippet: "Hi",
      },
      idempotencyKey: "discussion-reply:2",
      cause: { commentId: 2 },
    });

    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("discussion-reply");
    expect(await provider.readFeed(1, null, 20)).toEqual({
      notifications: [],
      nextCursor: null,
    });
    expect(await provider.readCounts(1)).toEqual({ unseen: 0, unread: 0 });
  });
});

import { describe, it, expect } from "vitest";
import {
  type FakeProvider,
  fakeProvider,
  noopProvider,
} from "./notifications.server";

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

describe("fakeProvider bulk marks", () => {
  const reader = { id: 1, name: "Ada", email: "ada@example.com", avatarUrl: null };
  const replier = { id: 2, name: "Grace", email: "grace@example.com", avatarUrl: null };

  function reply(recipient: typeof reader, commentId: number) {
    return {
      kind: "discussion-reply" as const,
      recipients: [recipient],
      actor: replier,
      data: {
        commentId,
        questionId: 1,
        lessonId: 1,
        lessonTitle: "Closures",
        courseSlug: "js",
        snippet: `Reply ${commentId}`,
      },
      idempotencyKey: `discussion-reply:${commentId}`,
      cause: { commentId },
    };
  }

  async function feedOf(count: number) {
    const provider = fakeProvider();
    for (let i = 1; i <= count; i++) await provider.send(reply(reader, i));
    return provider;
  }

  async function wholeFeed(provider: FakeProvider, userId: number) {
    const all = [];
    let cursor: string | null = null;
    do {
      const page = await provider.readFeed(userId, cursor, 2);
      all.push(...page.notifications);
      cursor = page.nextCursor;
    } while (cursor);
    return all;
  }

  it("marks all seen, including Notifications that haven't loaded, without reading them", async () => {
    const provider = await feedOf(5);

    await provider.markAllSeen(reader.id);

    expect(await provider.readCounts(reader.id)).toEqual({ unseen: 0, unread: 5 });
    const feed = await wholeFeed(provider, reader.id);
    expect(feed).toHaveLength(5);
    expect(feed.every((n) => n.seen && !n.read)).toBe(true);
  });

  it("marks all read, including Notifications that haven't loaded", async () => {
    const provider = await feedOf(5);

    await provider.markAllRead(reader.id);

    expect(await provider.readCounts(reader.id)).toEqual({ unseen: 0, unread: 0 });
    expect((await wholeFeed(provider, reader.id)).every((n) => n.read)).toBe(true);
  });

  it("leaves other people's Feeds alone", async () => {
    const provider = await feedOf(3);
    await provider.send(reply(replier, 99));

    await provider.markAllSeen(reader.id);
    await provider.markAllRead(reader.id);

    expect(await provider.readCounts(replier.id)).toEqual({ unseen: 1, unread: 1 });
  });
});

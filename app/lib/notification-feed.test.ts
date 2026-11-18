import { describe, it, expect } from "vitest";
import type { FeedRow } from "./notifications";
import {
  addFeedPage,
  emptyFeed,
  feedRowClick,
  markFeedAllRead,
  markFeedRowRead,
} from "./notification-feed";

function row(id: string, sentAt: string, overrides: Partial<FeedRow> = {}): FeedRow {
  return {
    id,
    kind: "discussion-reply",
    topic: "discussion-replies",
    actor: { name: "Grace", avatarUrl: null },
    title: "Grace replied to your question",
    snippet: "Because scope.",
    link: "/courses/js/lessons/1#comment-1",
    sentAt,
    seen: false,
    read: false,
    ...overrides,
  };
}

describe("addFeedPage", () => {
  it("adds older pages below, newest first, until there are no more", () => {
    let feed = addFeedPage(emptyFeed, {
      rows: [row("c", "2026-11-03T00:00:00Z"), row("b", "2026-11-02T00:00:00Z")],
      nextCursor: "2",
    });
    expect(feed.hasMore).toBe(true);
    expect(feed.cursor).toBe("2");

    // A new arrival shifted the pages, so "b" comes back again.
    feed = addFeedPage(feed, {
      rows: [row("b", "2026-11-02T00:00:00Z"), row("a", "2026-11-01T00:00:00Z")],
      nextCursor: null,
    });

    expect(feed.rows.map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(feed.hasMore).toBe(false);
  });

  it("keeps a row read that was marked here, even if a page loads with the old state", () => {
    let feed = addFeedPage(emptyFeed, {
      rows: [row("a", "2026-11-01T00:00:00Z")],
      nextCursor: "1",
    });
    feed = markFeedRowRead(feed, "a");

    feed = addFeedPage(feed, {
      rows: [row("a", "2026-11-01T00:00:00Z")],
      nextCursor: null,
    });

    expect(feed.rows[0].read).toBe(true);
  });

  it("starts empty with a first page still to load", () => {
    expect(emptyFeed.rows).toEqual([]);
    expect(emptyFeed.hasMore).toBe(true);
    expect(emptyFeed.cursor).toBeNull();
  });
});

describe("markFeedRowRead", () => {
  it("marks just that row read", () => {
    let feed = addFeedPage(emptyFeed, {
      rows: [row("b", "2026-11-02T00:00:00Z"), row("a", "2026-11-01T00:00:00Z")],
      nextCursor: null,
    });

    feed = markFeedRowRead(feed, "b");

    expect(feed.rows.map((r) => [r.id, r.read])).toEqual([
      ["b", true],
      ["a", false],
    ]);
  });
});

describe("markFeedAllRead", () => {
  it("marks loaded rows read, and older rows read once they're scrolled to", () => {
    let feed = addFeedPage(emptyFeed, {
      rows: [row("c", "2026-11-03T00:00:00Z")],
      nextCursor: "1",
    });

    feed = markFeedAllRead(feed, "2026-11-04T00:00:00Z");
    expect(feed.rows[0].read).toBe(true);

    // The provider's bulk mark hasn't reached this page yet.
    feed = addFeedPage(feed, {
      rows: [row("b", "2026-11-02T00:00:00Z")],
      nextCursor: null,
    });
    expect(feed.rows.map((r) => r.read)).toEqual([true, true]);
  });

  it("leaves a Notification that arrives afterwards unread", () => {
    let feed = markFeedAllRead(emptyFeed, "2026-11-04T00:00:00Z");

    feed = addFeedPage(feed, {
      rows: [row("d", "2026-11-05T00:00:00Z")],
      nextCursor: null,
    });

    expect(feed.rows[0].read).toBe(false);
  });
});

describe("feedRowClick", () => {
  it("marks an unread row with no link read and goes nowhere", () => {
    expect(feedRowClick(row("a", "2026-11-01T00:00:00Z", { link: null }))).toEqual({
      markRead: true,
      navigateTo: null,
    });
  });

  it("goes to the row's link, marking it read only if it isn't already", () => {
    const link = "/courses/js/lessons/1#comment-1";

    expect(feedRowClick(row("a", "2026-11-01T00:00:00Z"))).toEqual({
      markRead: true,
      navigateTo: link,
    });
    expect(feedRowClick(row("a", "2026-11-01T00:00:00Z", { read: true }))).toEqual({
      markRead: false,
      navigateTo: link,
    });
  });
});

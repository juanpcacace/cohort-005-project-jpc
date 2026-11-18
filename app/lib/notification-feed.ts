import type { FeedRow, FeedRowPage } from "~/lib/notifications";

// ─── Notification Feed state (browser) ───
// What the popover holds while open: every loaded row, the cursor for the next
// (older) page, and the optimistic marks. Pure functions so the bell component
// stays thin.

export type FeedState = {
  /** Every loaded row, newest first, one per id. */
  rows: FeedRow[];
  /** Pass to the feed route for the next (older) page; null reads the first. */
  cursor: string | null;
  /** False once the last page has loaded. */
  hasMore: boolean;
  /**
   * When "Mark all as read" was clicked. The provider's bulk mark runs in the
   * background, so a page loaded straight after may still say unread; rows
   * sent before this show as read regardless.
   */
  allReadAt: string | null;
};

export const emptyFeed: FeedState = {
  rows: [],
  cursor: null,
  hasMore: true,
  allReadAt: null,
};

function withMarks(state: FeedState, row: FeedRow): FeedRow {
  if (row.read || !state.allReadAt || row.sentAt > state.allReadAt) return row;
  return { ...row, read: true, seen: true };
}

/** Adds the next (older) page. Rows already loaded are replaced, not repeated. */
export function addFeedPage(state: FeedState, page: FeedRowPage): FeedState {
  const byId = new Map(state.rows.map((r) => [r.id, r]));
  for (const r of page.rows) {
    const loaded = byId.get(r.id);
    // Never undo a mark made here while its request is in flight.
    byId.set(r.id, loaded?.read ? { ...r, read: true, seen: true } : r);
  }
  const rows = [...byId.values()]
    .map((r) => withMarks(state, r))
    .sort((a, b) => (a.sentAt < b.sentAt ? 1 : a.sentAt > b.sentAt ? -1 : 0));
  return {
    ...state,
    rows,
    cursor: page.nextCursor,
    hasMore: page.nextCursor !== null,
  };
}

/** Marks one loaded row read (the ✓, or a click). */
export function markFeedRowRead(state: FeedState, id: string): FeedState {
  return {
    ...state,
    rows: state.rows.map((r) =>
      r.id === id ? { ...r, read: true, seen: true } : r
    ),
  };
}

/** "Mark all as read": every row sent up to `now`, loaded or not. */
export function markFeedAllRead(state: FeedState, now: string): FeedState {
  const marked = { ...state, allReadAt: now };
  return { ...marked, rows: state.rows.map((r) => withMarks(marked, r)) };
}

/**
 * What clicking a row does. An unread row is marked read. A row with no link
 * (the Refund Request confirmation, say) goes nowhere, so the popover stays open.
 */
export function feedRowClick(row: FeedRow): {
  markRead: boolean;
  navigateTo: string | null;
} {
  return { markRead: !row.read, navigateTo: row.link };
}

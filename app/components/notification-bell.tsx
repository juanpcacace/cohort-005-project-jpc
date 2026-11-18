import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  Bell,
  Check,
  GraduationCap,
  type LucideIcon,
  MessageSquare,
  Receipt,
  UsersRound,
} from "lucide-react";
import { UserAvatar } from "~/components/user-avatar";
import {
  FEED_POLL_INTERVAL_MS,
  type FeedCounts,
  type FeedRow,
  type FeedRowPage,
  type NotificationTopic,
} from "~/lib/notifications";
import {
  addFeedPage,
  emptyFeed,
  type FeedState,
  feedRowClick,
  markFeedAllRead,
  markFeedRowRead,
} from "~/lib/notification-feed";
import { cn, formatRelativeTime } from "~/lib/utils";

// ─── Notification bell ───
// Sits in the sidebar header. Polls Cadence (never the vendor) for the unseen
// count on an interval and when the window regains focus. Render it with
// `key={userId}` so a DevUI user switch starts fresh. Opening the popover
// marks everything seen; the list loads page by page as it scrolls.

/**
 * The provider's bulk marks run in the background, so a counts poll straight
 * after one can still report the old numbers. Polls this soon after a bulk
 * mark keep the optimistic count instead.
 */
const BULK_MARK_SETTLE_MS = 10_000;

const TOPIC_ICONS: Record<NotificationTopic, LucideIcon> = {
  "discussion-questions": MessageSquare,
  "discussion-replies": MessageSquare,
  "refund-request-updates": Receipt,
  "open-refund-requests": Receipt,
  "seat-claims": UsersRound,
  enrollments: GraduationCap,
};

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json() as Promise<T>;
}

function post(url: string, body?: unknown): Promise<void> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then(
    () => {},
    () => {
      // Best-effort; the next poll shows the real state.
    }
  );
}

function useFeedCounts() {
  const [counts, setCounts] = useState<FeedCounts>({ unseen: 0, unread: 0 });
  const settle = useRef({ seenUntil: 0, readUntil: 0 });

  const refresh = useCallback(() => {
    getJson<FeedCounts>("/api/notifications/counts")
      .then((fresh) => {
        const now = Date.now();
        setCounts({
          unseen: now < settle.current.seenUntil ? 0 : fresh.unseen,
          unread: now < settle.current.readUntil ? 0 : fresh.unread,
        });
      })
      .catch(() => {
        // Keep the last counts; the next poll tries again.
      });
  }, []);

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, FEED_POLL_INTERVAL_MS);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  const markAllSeen = useCallback(() => {
    settle.current.seenUntil = Date.now() + BULK_MARK_SETTLE_MS;
    setCounts((c) => ({ ...c, unseen: 0 }));
    void post("/api/notifications/seen-all");
  }, []);

  const markAllRead = useCallback(() => {
    settle.current.readUntil = Date.now() + BULK_MARK_SETTLE_MS;
    setCounts({ unseen: 0, unread: 0 });
    void post("/api/notifications/read-all");
  }, []);

  const markOneRead = useCallback((id: string) => {
    setCounts((c) => ({ ...c, unread: Math.max(0, c.unread - 1) }));
    void post("/api/notifications/read", { id });
  }, []);

  return { counts, refresh, markAllSeen, markAllRead, markOneRead };
}

export function NotificationBell() {
  const { counts, refresh, markAllSeen, markAllRead, markOneRead } =
    useFeedCounts();
  const [open, setOpen] = useState(false);
  const unseen = counts.unseen;

  function toggle() {
    if (!open) markAllSeen();
    setOpen(!open);
  }

  return (
    <>
      <button
        type="button"
        title="Notifications"
        aria-label={unseen > 0 ? `Notifications (${unseen} new)` : "Notifications"}
        aria-expanded={open}
        onClick={toggle}
        className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Bell className="size-4" />
        {unseen > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unseen > 9 ? "9+" : unseen}
          </span>
        )}
      </button>
      {open && (
        <NotificationPopover
          unread={counts.unread}
          onMarkAllRead={markAllRead}
          onMarkRead={markOneRead}
          onClose={() => {
            setOpen(false);
            refresh();
          }}
        />
      )}
    </>
  );
}

function NotificationPopover({
  unread,
  onMarkAllRead,
  onMarkRead,
  onClose,
}: {
  unread: number;
  onMarkAllRead: () => void;
  onMarkRead: (id: string) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [feed, setFeed] = useState<FeedState>(emptyFeed);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const loadingRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef(feed);
  feedRef.current = feed;

  const loadMore = useCallback(() => {
    const { hasMore, cursor } = feedRef.current;
    if (!hasMore || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    getJson<FeedRowPage>(`/api/notifications/feed${query}`)
      .then((page) => setFeed((current) => addFeedPage(current, page)))
      .catch(() => setFailed(true))
      .finally(() => {
        loadingRef.current = false;
        setLoading(false);
      });
  }, []);

  // Load the next page whenever the sentinel at the bottom scrolls into view.
  // The first page loads at once because the sentinel starts visible.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || failed) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { root: listRef.current, rootMargin: "64px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
    // Re-observe after each page, so a sentinel still in view loads the next.
  }, [loadMore, failed, feed.cursor, feed.rows.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function markRead(row: FeedRow) {
    setFeed((current) => markFeedRowRead(current, row.id));
    onMarkRead(row.id);
  }

  function openRow(row: FeedRow) {
    const click = feedRowClick(row);
    if (click.markRead) markRead(row);
    if (!click.navigateTo) return;
    onClose();
    navigate(click.navigateTo);
  }

  function markAllRead() {
    setFeed((current) => markFeedAllRead(current, new Date().toISOString()));
    onMarkAllRead();
  }

  const anyUnread = unread > 0 || feed.rows.some((r) => !r.read);
  const empty = !feed.hasMore && feed.rows.length === 0;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label="Notifications"
        className="fixed left-56 top-2 z-50 ml-2 flex max-h-[calc(100vh-1rem)] w-[26rem] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl"
      >
        <div className="flex items-center gap-2 bg-muted/60 px-4 py-3">
          <Bell className="size-4" />
          <span className="text-sm font-semibold">Notifications</span>
          <button
            type="button"
            onClick={markAllRead}
            disabled={!anyUnread}
            className="ml-auto text-xs font-medium text-primary hover:underline disabled:opacity-40 disabled:hover:no-underline"
          >
            Mark all as read
          </button>
        </div>
        <div ref={listRef} className="flex-1 overflow-y-auto">
          {failed && feed.rows.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Couldn&apos;t load your Notifications.
            </p>
          ) : empty ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              You&apos;re all caught up.
            </p>
          ) : (
            <>
              {feed.rows.map((row) => (
                <FeedRowItem
                  key={row.id}
                  row={row}
                  onOpen={() => openRow(row)}
                  onMarkRead={() => markRead(row)}
                />
              ))}
              {!failed && (
                <div
                  ref={sentinelRef}
                  className="p-3 text-center text-xs text-muted-foreground"
                >
                  {feed.hasMore || loading
                    ? "Loading…"
                    : feed.rows.length > 0 && "That's everything."}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function FeedRowItem({
  row,
  onOpen,
  onMarkRead,
}: {
  row: FeedRow;
  onOpen: () => void;
  onMarkRead: () => void;
}) {
  const TopicIcon = TOPIC_ICONS[row.topic];

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent">
      <span className={cn("relative shrink-0", row.read && "opacity-60")}>
        {row.actor ? (
          <UserAvatar
            name={row.actor.name}
            avatarUrl={row.actor.avatarUrl}
            className="size-9"
          />
        ) : (
          <span className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
            C
          </span>
        )}
        <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-popover text-muted-foreground ring-1 ring-border [&_svg]:size-2.5">
          <TopicIcon />
        </span>
      </span>
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 text-left"
      >
        <span
          className={cn("block truncate text-sm", !row.read && "font-semibold")}
        >
          {row.title}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {row.snippet} · {formatRelativeTime(row.sentAt)}
        </span>
      </button>
      {!row.read && (
        <button
          type="button"
          title="Mark as read"
          aria-label="Mark as read"
          onClick={onMarkRead}
          className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-background hover:text-primary"
        >
          <Check className="size-4" />
        </button>
      )}
    </div>
  );
}

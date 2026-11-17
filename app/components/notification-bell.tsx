import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Bell } from "lucide-react";
import { UserAvatar } from "~/components/user-avatar";
import {
  FEED_POLL_INTERVAL_MS,
  type FeedCounts,
  type FeedRow,
  type FeedRowPage,
} from "~/lib/notifications";
import { cn, formatRelativeTime } from "~/lib/utils";

// ─── Notification bell ───
// Sits in the sidebar header. Polls Cadence (never the vendor) for the unseen
// count on an interval and when the window regains focus. Render it with
// `key={userId}` so a DevUI user switch starts fresh.

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json() as Promise<T>;
}

function useUnseenCount() {
  const [counts, setCounts] = useState<FeedCounts>({ unseen: 0, unread: 0 });

  const refresh = useCallback(() => {
    getJson<FeedCounts>("/api/notifications/counts")
      .then(setCounts)
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

  return { counts, refresh };
}

export function NotificationBell() {
  const { counts, refresh } = useUnseenCount();
  const [open, setOpen] = useState(false);
  const unseen = counts.unseen;

  return (
    <>
      <button
        type="button"
        title="Notifications"
        aria-label={unseen > 0 ? `Notifications (${unseen} new)` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
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
          onClose={() => {
            setOpen(false);
            refresh();
          }}
        />
      )}
    </>
  );
}

function NotificationPopover({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [page, setPage] = useState<FeedRowPage | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getJson<FeedRowPage>("/api/notifications/feed")
      .then((first) => !cancelled && setPage(first))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function openRow(row: FeedRow) {
    if (!row.read) {
      setPage((current) =>
        current && {
          ...current,
          rows: current.rows.map((r) =>
            r.id === row.id ? { ...r, read: true, seen: true } : r
          ),
        }
      );
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id }),
      }).catch(() => {});
    }
    if (!row.link) return;
    onClose();
    navigate(row.link);
  }

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
        </div>
        <div className="flex-1 overflow-y-auto">
          {failed ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Couldn&apos;t load your Notifications.
            </p>
          ) : page === null ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Loading…
            </p>
          ) : page.rows.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              You&apos;re all caught up.
            </p>
          ) : (
            page.rows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => openRow(row)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent"
              >
                {row.actor ? (
                  <UserAvatar
                    name={row.actor.name}
                    avatarUrl={row.actor.avatarUrl}
                    className={cn("size-9 shrink-0", row.read && "opacity-60")}
                  />
                ) : (
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground",
                      row.read && "opacity-60"
                    )}
                  >
                    C
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-sm",
                      !row.read && "font-semibold"
                    )}
                  >
                    {row.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {row.snippet} · {formatRelativeTime(row.sentAt)}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}

// PROTOTYPE, throwaway. "What does the Notification Feed look like in Cadence?"
// (juanpcacace/cohort-005-project-jpc#56). Lives on prototype/notification-feed only.
//
// Three structurally different Notification Feeds, switchable with ?variant=
// (A, B, C) or the floating bar / ← → keys. All read the real Knock feed from
// the browser with the DevUI user's signed token.
//   A  Bell popover: bell in the sidebar header, compact dropdown list.
//   B  Inbox page: "Notifications" nav item with a count, full page at
//      /prototype/notifications with Unread / All tabs, grouped by day.
//   C  Activity rail: a third column beside the page, always visible, rich
//      cards with a call-to-action button each.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Link, NavLink, useFetcher, useLocation, useNavigate, useSearchParams } from "react-router";
import {
  Bell,
  BellDot,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  GraduationCap,
  MessageCircleQuestion,
  MessageSquareReply,
  PanelRightClose,
  Receipt,
  UsersRound,
} from "lucide-react";
import { cn } from "~/lib/utils";

const KNOCK_API = "https://api.knock.app/v1";

export type FeedConfig = {
  publicApiKey: string;
  feedChannelId: string;
  knockUserId: string;
  userToken: string;
};

type FeedItem = {
  id: string;
  inserted_at: string;
  read_at: string | null;
  seen_at: string | null;
  data: Record<string, any>;
};

type FeedMeta = { unread_count: number; unseen_count: number; total_count: number };

// ---------------------------------------------------------------------------
// Feed state from Knock's headless API. The first page is polled every 4s;
// older pages load on demand with the `after` cursor and are kept, so a feed
// of hundreds never loads all at once. The counts in `meta` always cover the
// whole feed, whatever is loaded.

const PAGE_SIZE = 20;

function mergeById(a: FeedItem[], b: FeedItem[]) {
  const byId = new Map([...a, ...b].map((e) => [e.id, e]));
  return [...byId.values()].sort((x, y) => y.inserted_at.localeCompare(x.inserted_at));
}

function useKnockFeed(config: FeedConfig | null) {
  const [entries, setEntries] = useState<FeedItem[]>([]);
  const [meta, setMeta] = useState<FeedMeta>({ unread_count: 0, unseen_count: 0, total_count: 0 });
  const [loaded, setLoaded] = useState(false);
  const [after, setAfter] = useState<string | null>(null); // cursor of the oldest loaded page
  const [loadingMore, setLoadingMore] = useState(false);

  // The layout re-signs the token on every navigation; keep the latest in a
  // ref so a fresh token doesn't throw away the pages already loaded.
  const configRef = useRef(config);
  configRef.current = config;
  const headers = () => ({
    Authorization: `Bearer ${configRef.current!.publicApiKey}`,
    "X-Knock-User-Token": configRef.current!.userToken,
    "Content-Type": "application/json",
  });
  const feedUrl = (q: string) =>
    `${KNOCK_API}/users/${configRef.current!.knockUserId}/feeds/${configRef.current!.feedChannelId}?page_size=${PAGE_SIZE}${q}`;

  const userId = config?.knockUserId;

  // Newest page only: new arrivals are merged in, older loaded pages are kept.
  const load = useCallback(async () => {
    if (!configRef.current) return;
    const res = await fetch(feedUrl(""), { headers: headers() });
    if (!res.ok) return;
    const json = await res.json();
    setEntries((prev) => {
      const fresh = new Set(json.entries.map((e: FeedItem) => e.id));
      const oldest = json.entries.at(-1)?.inserted_at ?? "";
      // Drop anything within the first page's window that Knock no longer
      // returns (archived), keep everything older.
      return mergeById(prev.filter((e) => fresh.has(e.id) || e.inserted_at < oldest), json.entries);
    });
    setAfter((a) => a ?? json.page_info.after);
    setMeta(json.meta);
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function loadMore() {
    if (!after || loadingMore) return;
    setLoadingMore(true);
    const res = await fetch(feedUrl(`&after=${encodeURIComponent(after)}`), { headers: headers() });
    if (res.ok) {
      const json = await res.json();
      setEntries((prev) => mergeById(prev, json.entries));
      setAfter(json.page_info.after);
    }
    setLoadingMore(false);
  }

  useEffect(() => {
    setEntries([]);
    setAfter(null);
    setLoaded(false);
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  async function mark(status: "read" | "seen" | "unread" | "archived", ids: string[]) {
    if (!configRef.current || ids.length === 0) return; // Knock 422s on an empty batch
    const now = new Date().toISOString();
    setEntries((prev) =>
      prev.map((e) =>
        !ids.includes(e.id)
          ? e
          : status === "read"
            ? { ...e, read_at: now, seen_at: e.seen_at ?? now }
            : status === "unread"
              ? { ...e, read_at: null }
              : status === "seen"
                ? { ...e, seen_at: now }
                : e
      )
    );
    await fetch(`${KNOCK_API}/messages/batch/${status}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ message_ids: ids }),
    });
    load();
  }

  // Whole-feed operations, including pages never loaded. Knock queues these
  // as a bulk operation, so update locally now and re-poll a moment later.
  async function bulk(status: "read" | "seen" | "archive", engagement: "unread" | "unseen" | "all") {
    if (!configRef.current) return;
    const now = new Date().toISOString();
    if (status === "archive") {
      setEntries([]);
      setAfter(null);
    } else {
      setEntries((prev) =>
        prev.map((e) =>
          status === "read" ? { ...e, read_at: e.read_at ?? now, seen_at: e.seen_at ?? now } : { ...e, seen_at: e.seen_at ?? now }
        )
      );
    }
    setMeta((m) =>
      status === "read"
        ? { ...m, unread_count: 0, unseen_count: 0 }
        : status === "seen"
          ? { ...m, unseen_count: 0 }
          : { unread_count: 0, unseen_count: 0, total_count: 0 }
    );
    await fetch(`${KNOCK_API}/channels/${configRef.current.feedChannelId}/messages/bulk/${status}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user_ids: [configRef.current.knockUserId], engagement_status: engagement }),
    });
    setTimeout(load, 1500);
  }

  return {
    entries,
    meta,
    loaded,
    hasMore: !!after && entries.length < meta.total_count,
    loadingMore,
    loadMore,
    reload: load,
    markRead: (ids: string[]) => mark("read", ids),
    markUnread: (ids: string[]) => mark("unread", ids),
    markAllSeen: () => meta.unseen_count > 0 && bulk("seen", "unseen"),
    markAllRead: () => bulk("read", "unread"),
    archiveAll: () => bulk("archive", "all"),
  };
}

type Feed = ReturnType<typeof useKnockFeed>;
const FeedContext = createContext<Feed | null>(null);
export const useFeed = () => useContext(FeedContext)!;

// ---------------------------------------------------------------------------
// What each catalogue entry says. Rendered from `data`, not Knock's template.

function describe(item: FeedItem) {
  const d = item.data;
  switch (d.kind) {
    case "refund-approved":
      return {
        icon: <CircleCheck className="size-4 text-emerald-600" />,
        title: <>Your Refund Request for <b>{d.courseTitle}</b> was approved</>,
        detail: d.note,
        cta: "View course",
      };
    case "refund-declined":
      return {
        icon: <CircleX className="size-4 text-rose-600" />,
        title: <>Your Refund Request for <b>{d.courseTitle}</b> was declined</>,
        detail: `${d.note} You can ask again.`,
        cta: "View course",
      };
    case "open-refund-request":
      return {
        icon: <Receipt className="size-4 text-amber-600" />,
        title: <><b>{d.actorName}</b> asked for a {d.amount} refund on <b>{d.courseTitle}</b></>,
        detail: `"${d.reason}"`,
        cta: "Review request",
      };
    case "seat-claimed":
      return {
        icon: <UsersRound className="size-4 text-sky-600" />,
        title: <><b>{d.actorName}</b> claimed a Seat on <b>{d.courseTitle}</b></>,
        detail: `${d.seatsLeft} Seats left`,
        cta: "View team",
      };
    case "new-enrollment":
      return {
        icon: <GraduationCap className="size-4 text-violet-600" />,
        title: <><b>{d.actorName}</b> enrolled in <b>{d.courseTitle}</b></>,
        detail: undefined,
        cta: "View students",
      };
    case "discussion-question":
      return {
        icon: <MessageCircleQuestion className="size-4 text-orange-600" />,
        title: <><b>{d.actorName}</b> asked a question in <b>{d.lessonTitle}</b></>,
        detail: `"${d.snippet}"`,
        cta: "Answer",
      };
    default:
      return {
        icon: <MessageSquareReply className="size-4 text-blue-600" />,
        title: <><b>{d.actorName ?? d.replierName}</b> replied to your question in <b>{d.lessonTitle}</b></>,
        detail: d.snippet ?? d.questionExcerpt,
        cta: "View reply",
      };
  }
}

function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function UnreadBadge({ count, className }: { count: number; className?: string }) {
  if (count === 0) return null;
  return (
    <span
      className={cn(
        "inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold leading-5 text-primary-foreground",
        className
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

// Clicking a Notification marks it read and goes where it points.
function useOpen() {
  const feed = useFeed();
  const navigate = useNavigate();
  return (item: FeedItem) => {
    if (!item.read_at) feed.markRead([item.id]);
    if (item.data.url) navigate(item.data.url);
  };
}

function EmptyState({ unreadOnly }: { unreadOnly?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
      <Bell className="size-6 opacity-40" />
      {unreadOnly ? "You're all caught up." : "No Notifications yet."}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant A: bell popover in the sidebar header.

function VariantABell() {
  const feed = useFeed();
  const open = useOpen();
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    feed.markAllSeen(); // opening the feed clears the badge (seen), not read
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setIsOpen((o) => !o)}
        title="Notifications"
        className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Bell className="size-5" />
        <UnreadBadge count={feed.meta.unseen_count} className="absolute -right-1 -top-1" />
      </button>
      {isOpen && (
        <div className="fixed left-52 top-3 z-50 w-96 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="font-semibold">Notifications</span>
            <button
              onClick={feed.markAllRead}
              disabled={feed.meta.unread_count === 0}
              className="text-xs text-primary hover:underline disabled:opacity-40"
            >
              Mark all as read
            </button>
          </div>
          <ul className="max-h-[28rem] overflow-y-auto">
            {feed.entries.length === 0 && <EmptyState />}
            {feed.entries.map((item) => {
              const t = describe(item);
              return (
                <li key={item.id}>
                  <button
                    onClick={() => {
                      open(item);
                      setIsOpen(false);
                    }}
                    className={cn(
                      "flex w-full gap-3 border-b px-4 py-3 text-left text-sm last:border-0 hover:bg-accent",
                      !item.read_at && "bg-primary/5"
                    )}
                  >
                    <span className="mt-0.5">{t.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block leading-snug">{t.title}</span>
                      {t.detail && (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{t.detail}</span>
                      )}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-xs text-muted-foreground">{timeAgo(item.inserted_at)}</span>
                      {!item.read_at && <span className="size-2 rounded-full bg-primary" />}
                    </span>
                  </button>
                </li>
              );
            })}
            <LoadMoreSentinel />
          </ul>
          <div className="border-t px-4 py-2 text-center text-xs text-muted-foreground">
            Showing {feed.entries.length} of {feed.meta.total_count}
          </div>
        </div>
      )}
    </div>
  );
}

// Scrolling this into view (the bottom of the list) loads the next page.
function LoadMoreSentinel() {
  const feed = useFeed();
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !feed.hasMore) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && feed.loadMore());
    io.observe(el);
    return () => io.disconnect();
  });
  if (!feed.hasMore) return null;
  return (
    <li ref={ref} className="px-4 py-3 text-center text-xs text-muted-foreground">
      {feed.loadingMore ? "Loading…" : "Scroll for more"}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Variant B: nav item + full inbox page.

function VariantBNavItem() {
  const feed = useFeed();
  return (
    <NavLink
      to="/prototype/notifications"
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )
      }
    >
      <Bell className="size-4" />
      <span className="flex-1">Notifications</span>
      <UnreadBadge count={feed.meta.unread_count} />
    </NavLink>
  );
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export function VariantBInboxPage() {
  const feed = useFeed();
  const open = useOpen();
  const [tab, setTab] = useState<"unread" | "all">("all");
  const items = tab === "unread" ? feed.entries.filter((e) => !e.read_at) : feed.entries;

  useEffect(() => {
    if (feed.loaded) feed.markAllSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.loaded, feed.meta.unseen_count]);

  const groups = new Map<string, FeedItem[]>();
  for (const item of items) {
    const key = dayLabel(item.inserted_at);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-sm text-muted-foreground">{feed.meta.unread_count} unread</p>
        </div>
        <button
          onClick={feed.markAllRead}
          disabled={feed.meta.unread_count === 0}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-40"
        >
          <CheckCheck className="size-4" /> Mark all as read
        </button>
      </div>
      <div className="mb-4 flex gap-1 border-b">
        {(["all", "unread"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium capitalize",
              tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
            )}
          >
            {t}
          </button>
        ))}
      </div>
      {items.length === 0 && <EmptyState unreadOnly={tab === "unread"} />}
      {[...groups].map(([label, group]) => (
        <section key={label} className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</h2>
          <ul className="divide-y rounded-lg border">
            {group.map((item) => {
              const t = describe(item);
              return (
                <li key={item.id} className={cn("group flex items-start gap-4 p-4", !item.read_at && "bg-primary/5")}>
                  <span className="mt-1 rounded-full bg-muted p-2">{t.icon}</span>
                  <button onClick={() => open(item)} className="min-w-0 flex-1 text-left">
                    <div className="text-sm leading-snug">{t.title}</div>
                    {t.detail && <div className="mt-1 text-sm text-muted-foreground">{t.detail}</div>}
                    <div className="mt-1 text-xs text-muted-foreground">
                      {new Date(item.inserted_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </div>
                  </button>
                  <button
                    onClick={() => (item.read_at ? feed.markUnread([item.id]) : feed.markRead([item.id]))}
                    className="shrink-0 text-xs text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
                  >
                    Mark as {item.read_at ? "unread" : "read"}
                  </button>
                  {!item.read_at && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" />}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant C: always-visible activity rail beside the page.

function VariantCRail() {
  const feed = useFeed();
  const open = useOpen();
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        title="Show Notifications"
        className="flex h-screen w-12 shrink-0 flex-col items-center gap-2 border-l bg-sidebar pt-4 text-sidebar-foreground/70 hover:text-sidebar-foreground"
      >
        {feed.meta.unread_count > 0 ? <BellDot className="size-5" /> : <Bell className="size-5" />}
        <UnreadBadge count={feed.meta.unread_count} />
      </button>
    );
  }

  return (
    <aside className="flex h-screen w-80 shrink-0 flex-col border-l bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <span className="font-semibold">Activity</span>
        <UnreadBadge count={feed.meta.unread_count} />
        <span className="flex-1" />
        <button onClick={feed.markAllRead} title="Mark all as read" className="rounded p-1 hover:bg-sidebar-accent">
          <CheckCheck className="size-4" />
        </button>
        <button onClick={() => setCollapsed(true)} title="Hide" className="rounded p-1 hover:bg-sidebar-accent">
          <PanelRightClose className="size-4" />
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {feed.entries.length === 0 && <EmptyState />}
        {feed.entries.map((item) => {
          const t = describe(item);
          return (
            <div
              key={item.id}
              className={cn(
                "rounded-lg border bg-card p-3 text-card-foreground shadow-sm",
                !item.read_at ? "border-l-4 border-l-primary" : "opacity-70"
              )}
            >
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                {t.icon}
                <span className="flex-1">{timeAgo(item.inserted_at)}</span>
                {!item.read_at && (
                  <button onClick={() => feed.markRead([item.id])} className="hover:text-foreground">
                    Dismiss
                  </button>
                )}
              </div>
              <div className="text-sm leading-snug">{t.title}</div>
              {t.detail && (
                <blockquote className="mt-2 border-l-2 pl-2 text-xs text-muted-foreground">{t.detail}</blockquote>
              )}
              <button
                onClick={() => open(item)}
                className="mt-3 w-full rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                {t.cta}
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Switcher + dev controls.

export const VARIANTS = [
  { key: "A", name: "Bell popover" },
  { key: "B", name: "Inbox page" },
  { key: "C", name: "Activity rail" },
] as const;
export type VariantKey = (typeof VARIANTS)[number]["key"];

// The variant lives in ?variant=, and in sessionStorage so it survives
// in-app navigation (links drop the search param).
export function useVariant(): VariantKey {
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get("variant") as VariantKey | null;
  useEffect(() => {
    if (fromUrl) {
      try {
        sessionStorage.setItem("prototype-feed-variant", fromUrl);
      } catch {}
      return;
    }
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem("prototype-feed-variant");
    } catch {}
    if (stored)
      setParams(
        (p) => {
          p.set("variant", stored!);
          return p;
        },
        { replace: true }
      );
  }, [fromUrl, setParams]);
  return VARIANTS.some((v) => v.key === fromUrl) ? fromUrl! : "A";
}

function PrototypeSwitcher({ current }: { current: VariantKey }) {
  const [, setParams] = useSearchParams();
  const feed = useFeed();
  const seed = useFetcher();
  const idx = VARIANTS.findIndex((v) => v.key === current);
  const go = useCallback(
    (delta: number) => {
      const next = VARIANTS[(idx + delta + VARIANTS.length) % VARIANTS.length]!.key;
      setParams(
        (p) => {
          p.set("variant", next);
          return p;
        },
        { replace: true }
      );
    },
    [idx, setParams]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  useEffect(() => {
    if (seed.state === "idle" && seed.data) setTimeout(feed.reload, 1500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed.state, seed.data]);

  const btn = "rounded-full px-2 py-1 hover:bg-white/15 disabled:opacity-40";
  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full bg-zinc-900 px-2 py-1.5 font-mono text-xs text-white shadow-2xl ring-2 ring-amber-400">
      <span className="px-2 text-amber-400">PROTOTYPE</span>
      <button onClick={() => go(-1)} className={btn} title="Previous (←)">
        <ChevronLeft className="size-4" />
      </button>
      <span className="w-32 text-center">
        {current} ({VARIANTS[idx]!.name})
      </span>
      <button onClick={() => go(1)} className={btn} title="Next (→)">
        <ChevronRight className="size-4" />
      </button>
      <span className="mx-1 h-4 w-px bg-white/30" />
      <span className="px-1 text-white/60">
        unread {feed.meta.unread_count} · unseen {feed.meta.unseen_count} · total {feed.meta.total_count}
      </span>
      <seed.Form method="post" action="/prototype/notifications" className="flex">
        <input type="hidden" name="intent" value="seed" />
        <button className={btn} disabled={seed.state !== "idle"}>Seed my feed</button>
      </seed.Form>
      <seed.Form method="post" action="/prototype/notifications" className="flex">
        <input type="hidden" name="intent" value="one" />
        <input type="hidden" name="n" value={feed.meta.total_count} />
        <button className={btn} disabled={seed.state !== "idle"}>+1 live</button>
      </seed.Form>
      <seed.Form method="post" action="/prototype/notifications" className="flex">
        <input type="hidden" name="intent" value="hundred" />
        <button className={btn} disabled={seed.state !== "idle"}>
          {seed.state !== "idle" ? "sending…" : "+100"}
        </button>
      </seed.Form>
      <button className={btn} onClick={feed.archiveAll}>Clear</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mount points used by the app layout and sidebar.

export function NotificationFeedPrototype({
  config,
  children,
}: {
  config: FeedConfig | null;
  children: (slots: { sidebarHeader: React.ReactNode; sidebarNav: React.ReactNode; rail: React.ReactNode; bar: React.ReactNode }) => React.ReactNode;
}) {
  const feed = useKnockFeed(config);
  const variant = useVariant();
  if (import.meta.env.PROD || !config) {
    return <>{children({ sidebarHeader: null, sidebarNav: null, rail: null, bar: null })}</>;
  }
  return (
    <FeedContext.Provider value={feed}>
      {children({
        sidebarHeader: variant === "A" ? <VariantABell /> : null,
        sidebarNav: variant === "B" ? <VariantBNavItem /> : null,
        rail: variant === "C" ? <VariantCRail /> : null,
        bar: <PrototypeSwitcher current={variant} />,
      })}
    </FeedContext.Provider>
  );
}

export function PrototypeNote() {
  const { pathname } = useLocation();
  return (
    <p className="mx-auto max-w-3xl px-8 pt-4 text-xs text-amber-700 dark:text-amber-300">
      PROTOTYPE ({pathname}): the full-page feed belongs to variant B. Other variants don't link here.{" "}
      <Link to="?variant=B" className="underline">Switch to B</Link>
    </p>
  );
}

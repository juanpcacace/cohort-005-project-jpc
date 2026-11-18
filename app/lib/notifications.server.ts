import { existsSync } from "node:fs";
import { knockProvider } from "~/lib/notifications.knock.server";
import {
  type FeedCounts,
  type FeedNotification,
  type FeedRowPage,
  type NotificationData,
  type NotificationKind,
  toFeedRow,
} from "~/lib/notifications";
import { NOTIFICATION_TOPICS } from "~/lib/notifications";
import {
  mergePreferences,
  type NotificationPreferenceChanges,
} from "~/lib/notification-preferences";

// ─── Notifications provider (ADR 0013) ───
// Every use of the Notifications vendor goes through `NotificationsProvider`,
// written in Cadence's terms. Three implementations, chosen like the mail
// transports: the Knock adapter when KNOCK_SECRET_API_KEY is set, a no-op that
// logs (empty Feed) when it isn't, and an in-memory fake for vitest.
//
// Services take the provider as a parameter, like `db`, and send after their
// write commits through `sendNotification`, which logs a failure instead of
// throwing: Notifications are best-effort and never fail a domain action.

/** A Cadence user as a recipient or actor of a Notification. */
export type NotificationPerson = {
  id: number;
  name: string;
  email: string;
  avatarUrl: string | null;
};

/** The domain object that caused a Notification, so it can be found again. */
export type NotificationCause = { commentId: number };

export type NewNotification = {
  [K in NotificationKind]: {
    kind: K;
    recipients: NotificationPerson[];
    /** Null when Cadence itself is the sender. */
    actor: NotificationPerson | null;
    data: NotificationData[K];
    /** One per domain event, e.g. `discussion-reply:<commentId>`. */
    idempotencyKey: string;
    cause: NotificationCause | null;
  };
}[NotificationKind];

export type FeedPage = {
  notifications: FeedNotification[];
  /** Pass back to read the next (older) page; null at the end. */
  nextCursor: string | null;
};

export interface NotificationsProvider {
  send(notification: NewNotification): Promise<void>;
  /** One page of the user's Feed, newest first. A null cursor reads the first page. */
  readFeed(userId: number, cursor: string | null, pageSize: number): Promise<FeedPage>;
  readCounts(userId: number): Promise<FeedCounts>;
  /** Marks one of the user's own Notifications read. Anyone else's is left alone. */
  markRead(userId: number, notificationId: string): Promise<void>;
  /** Marks every one of the user's Notifications seen, loaded or not. Seen isn't read. */
  markAllSeen(userId: number): Promise<void>;
  /** Marks every one of the user's Notifications read, loaded or not. */
  markAllRead(userId: number): Promise<void>;
  /** Removes every Notification the cause led to from its recipients' Feeds. */
  archive(cause: NotificationCause): Promise<void>;
  /** Creates or updates the user with their name, email and avatar. */
  identifyUser(person: NotificationPerson): Promise<void>;
  /** The user's stored Notification Preferences, or null when they have none yet. */
  readPreferences(userId: number): Promise<NotificationPreferenceChanges | null>;
  /** Merges `changes` into the stored set. Topics and channels left out keep their value. */
  setPreferences(userId: number, changes: NotificationPreferenceChanges): Promise<void>;
}

// ─── No-op ───

export function noopProvider(
  log: (message: string) => void = console.info
): NotificationsProvider {
  return {
    async send(notification) {
      log(
        `[notifications] ${notification.kind} to ${notification.recipients
          .map((r) => r.id)
          .join(", ")} (not sent: KNOCK_SECRET_API_KEY is not set)`
      );
    },
    async readFeed() {
      return { notifications: [], nextCursor: null };
    },
    async readCounts() {
      return { unseen: 0, unread: 0 };
    },
    async markRead() {},
    async markAllSeen() {},
    async markAllRead() {},
    async archive() {},
    async identifyUser() {},
    async readPreferences() {
      return null;
    },
    async setPreferences() {},
  };
}

// ─── In-memory fake (vitest) ───

export type FakeProvider = NotificationsProvider & {
  /** Every Notification sent, in order. */
  sent: NewNotification[];
  /** Every identified user by id, as last identified. */
  identified: Map<number, NotificationPerson>;
};

export function fakeProvider(now: () => Date = () => new Date()): FakeProvider {
  const sent: NewNotification[] = [];
  const identified = new Map<number, NotificationPerson>();
  const preferences = new Map<number, NotificationPreferenceChanges>();
  // Like Knock: a muted Topic creates no Feed entry at all. Unset counts as on.
  const isMuted = (userId: number, kind: NotificationKind) =>
    preferences.get(userId)?.[NOTIFICATION_TOPICS[kind]]?.feed === false;
  const feeds = new Map<number, FeedNotification[]>();
  /** Feed entry id → the comment that caused it, for `archive`. */
  const causes = new Map<string, number>();
  let nextId = 1;

  return {
    sent,
    identified,
    async send(notification) {
      sent.push(notification);
      for (const recipient of notification.recipients) {
        if (isMuted(recipient.id, notification.kind)) continue;
        const entry = {
          id: `n${nextId++}`,
          kind: notification.kind,
          actor: notification.actor && {
            name: notification.actor.name,
            avatarUrl: notification.actor.avatarUrl,
          },
          data: notification.data,
          sentAt: now().toISOString(),
          seen: false,
          read: false,
        } as FeedNotification;
        if (notification.cause) {
          causes.set(entry.id, notification.cause.commentId);
        }
        feeds.set(recipient.id, [entry, ...(feeds.get(recipient.id) ?? [])]);
      }
    },
    async readFeed(userId, cursor, pageSize) {
      const feed = feeds.get(userId) ?? [];
      const start = cursor ? Number(cursor) : 0;
      const end = start + pageSize;
      return {
        notifications: feed.slice(start, end),
        nextCursor: end < feed.length ? String(end) : null,
      };
    },
    async readCounts(userId) {
      const feed = feeds.get(userId) ?? [];
      return {
        unseen: feed.filter((n) => !n.seen).length,
        unread: feed.filter((n) => !n.read).length,
      };
    },
    async markRead(userId, notificationId) {
      const entry = feeds.get(userId)?.find((n) => n.id === notificationId);
      if (entry) {
        entry.read = true;
        entry.seen = true;
      }
    },
    async identifyUser(person) {
      identified.set(person.id, { ...person });
    },
    async readPreferences(userId) {
      return structuredClone(preferences.get(userId) ?? null);
    },
    async setPreferences(userId, changes) {
      preferences.set(
        userId,
        mergePreferences(preferences.get(userId) ?? null, changes)
      );
    },
    async markAllSeen(userId) {
      for (const entry of feeds.get(userId) ?? []) entry.seen = true;
    },
    async markAllRead(userId) {
      for (const entry of feeds.get(userId) ?? []) {
        entry.read = true;
        entry.seen = true;
      }
    },
    async archive(cause) {
      for (const [userId, feed] of feeds) {
        feeds.set(
          userId,
          feed.filter((n) => causes.get(n.id) !== cause.commentId)
        );
      }
    },
  };
}

// ─── Choosing one ───

/** The Knock adapter when KNOCK_SECRET_API_KEY is set, otherwise the no-op. */
export function defaultNotificationsProvider(): NotificationsProvider {
  // Vite dev and tsx leave non-VITE_ .env values off process.env.
  if (!process.env.KNOCK_SECRET_API_KEY && existsSync(".env")) {
    process.loadEnvFile(".env");
  }
  const secretKey = process.env.KNOCK_SECRET_API_KEY;
  const feedChannelId = process.env.KNOCK_FEED_CHANNEL_ID;
  if (secretKey && feedChannelId) {
    return knockProvider(secretKey, feedChannelId);
  }
  if (secretKey) {
    console.warn(
      "[notifications] KNOCK_FEED_CHANNEL_ID is not set; Notifications are off."
    );
  }
  return noopProvider();
}

// ─── Helpers for services and routes ───

/** Sends and logs any failure. Never throws. */
export async function sendNotification(
  provider: NotificationsProvider,
  notification: NewNotification
): Promise<void> {
  try {
    await provider.send(notification);
  } catch (error) {
    console.error(
      `[notifications] Failed to send ${notification.kind} (${notification.idempotencyKey})`,
      error
    );
  }
}

/** Archives what the cause led to and logs any failure. Never throws. */
export async function archiveNotifications(
  provider: NotificationsProvider,
  cause: NotificationCause
): Promise<void> {
  try {
    await provider.archive(cause);
  } catch (error) {
    console.error(
      `[notifications] Failed to archive Notifications for comment ${cause.commentId}`,
      error
    );
  }
}

/** One page of the user's Feed as Cadence-shaped rows. */
export async function readFeedRows(
  provider: NotificationsProvider,
  userId: number,
  cursor: string | null,
  pageSize: number
): Promise<FeedRowPage> {
  const page = await provider.readFeed(userId, cursor, pageSize);
  return {
    rows: page.notifications.map(toFeedRow),
    nextCursor: page.nextCursor,
  };
}

import Knock from "@knocklabs/node";
import type { FeedListItemsResponse } from "@knocklabs/node/resources/users/feeds";
import {
  type FeedActor,
  type FeedNotification,
  isNotificationKind,
} from "~/lib/notifications";
import type {
  NotificationPerson,
  NotificationsProvider,
} from "~/lib/notifications.server";

// ─── Knock adapter ───
// The only file that knows Knock. Cadence terms map to Knock's like this:
//   Notification kind   → workflow key (same string; each must be committed)
//   Notification        → one message per recipient on the in-app feed channel
//   Cadence user id     → Knock user id `String(id)`
//   cause.commentId     → top-level `causeCommentId` in the trigger data, so
//                         the messages can be found again by `trigger_data`
// Everything uses the secret key server-side; the browser never calls Knock.

type FeedBody = {
  entries: FeedListItemsResponse[];
  meta: { unseen_count: number; unread_count: number; total_count: number };
  page_info: { after: string | null };
};

function knockUser(person: NotificationPerson) {
  return {
    id: String(person.id),
    name: person.name,
    email: person.email,
    avatar: person.avatarUrl,
  };
}

function toActor(entry: FeedListItemsResponse): FeedActor | null {
  const actor = entry.actors[0];
  if (!actor || !("name" in actor)) return null;
  return {
    name: actor.name ?? "Someone",
    avatarUrl: ("avatar" in actor ? actor.avatar : null) ?? null,
  };
}

function toFeedNotification(
  entry: FeedListItemsResponse
): FeedNotification | null {
  const kind = entry.source.key;
  // Skip messages from workflows Cadence doesn't know (old spikes, say).
  if (!isNotificationKind(kind)) return null;
  return {
    id: entry.id,
    kind,
    actor: toActor(entry),
    data: entry.data as FeedNotification["data"],
    sentAt: entry.inserted_at,
    seen: Boolean(entry.seen_at),
    read: Boolean(entry.read_at),
  } as FeedNotification;
}

export function knockProvider(
  secretKey: string,
  feedChannelId: string
): NotificationsProvider {
  // Built on first use: the constructor throws without a key, and modules stay
  // free of side effects. No retries and a short timeout, because sends run
  // inline in a request.
  let client: Knock | null = null;
  const knock = () =>
    (client ??= new Knock({ apiKey: secretKey, maxRetries: 0, timeout: 5_000 }));

  function readFeedBody(userId: number, query: Record<string, unknown>) {
    return knock().get<FeedBody>(
      `/v1/users/${encodeURIComponent(String(userId))}/feeds/${encodeURIComponent(feedChannelId)}`,
      { query }
    );
  }

  return {
    async send(notification) {
      await knock().workflows.trigger(
        notification.kind,
        {
          recipients: notification.recipients.map(knockUser),
          actor: notification.actor ? knockUser(notification.actor) : null,
          data: {
            ...notification.data,
            causeCommentId: notification.cause?.commentId ?? null,
          },
        },
        { idempotencyKey: notification.idempotencyKey }
      );
    },

    async readFeed(userId, cursor, pageSize) {
      const body = await readFeedBody(userId, {
        page_size: pageSize,
        ...(cursor ? { after: cursor } : {}),
      });
      return {
        notifications: body.entries
          .map(toFeedNotification)
          .filter((n): n is FeedNotification => n !== null),
        nextCursor: body.page_info.after ?? null,
      };
    },

    async readCounts(userId) {
      // One request per poll: the counts come back with any page.
      const body = await readFeedBody(userId, { page_size: 1 });
      return { unseen: body.meta.unseen_count, unread: body.meta.unread_count };
    },

    async markRead(userId, notificationId) {
      // The secret key can mark anyone's message, so check it is theirs.
      const message = await knock().messages.get(notificationId);
      const recipientId =
        typeof message.recipient === "string"
          ? message.recipient
          : message.recipient.id;
      if (recipientId !== String(userId)) return;
      await knock().messages.markAsRead(notificationId);
    },

    // Bulk-by-channel covers messages the browser hasn't loaded. Always scope
    // to the one recipient: without `recipient_ids` it would hit everyone's.
    // Knock runs it asynchronously, so a counts read right after may lag.
    async markAllSeen(userId) {
      await knock().channels.bulk.updateMessageStatus(feedChannelId, "seen", {
        recipient_ids: [String(userId)],
        engagement_status: "unseen",
      });
    },

    async markAllRead(userId) {
      await knock().channels.bulk.updateMessageStatus(feedChannelId, "read", {
        recipient_ids: [String(userId)],
        engagement_status: "unread",
      });
    },
  };
}

import Knock from "@knocklabs/node";
import type { FeedListItemsResponse } from "@knocklabs/node/resources/users/feeds";
import type { PreferenceSet } from "@knocklabs/node/resources/recipients/preferences";
import {
  type FeedActor,
  type FeedNotification,
  isNotificationKind,
  type NotificationTopic,
} from "~/lib/notifications";
import type {
  NotificationPerson,
  NotificationsProvider,
} from "~/lib/notifications.server";
import {
  ALL_NOTIFICATION_TOPICS,
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
  type NotificationPreferenceChanges,
} from "~/lib/notification-preferences";

// ─── Notification Preferences in Knock ───
//   Notification Topic  → category key (committed on each workflow)
//   channel "feed"      → channel type `in_app_feed`
//   Preferences         → the user's `default` preference set, as
//                         categories.<key>.channel_types.<type> = boolean
// Knock's setPreferences replaces the whole set, so writes read the set, merge
// the changed Topic × channel values in, and PUT the whole set back.

const PREFERENCE_SET = "default";

const TOPIC_CATEGORY: Record<NotificationTopic, string> = {
  "refund-request-updates": "refund-request-updates",
  "open-refund-requests": "open-refund-requests",
  "seat-claims": "seat-claims",
  enrollments: "enrollments",
  "discussion-questions": "discussion-questions",
  "discussion-replies": "discussion-replies",
};

const CHANNEL_TYPE: Record<NotificationChannel, "in_app_feed"> = {
  feed: "in_app_feed",
};

type Categories = NonNullable<PreferenceSet["categories"]>;
type CategorySetting = Categories[string];
type CategorySettingObject = Exclude<CategorySetting, boolean>;

/** A boolean for the channel, or undefined when it's unset or conditional. */
function channelValue(
  setting: CategorySetting,
  channel: NotificationChannel
): boolean | undefined {
  if (typeof setting === "boolean") return setting;
  const value = setting.channel_types?.[CHANNEL_TYPE[channel]];
  return typeof value === "boolean" ? value : undefined;
}

function toPreferences(
  set: PreferenceSet | null
): NotificationPreferenceChanges | null {
  const categories = set?.categories;
  if (!categories) return null;
  const preferences: NotificationPreferenceChanges = {};
  for (const topic of ALL_NOTIFICATION_TOPICS) {
    const setting = categories[TOPIC_CATEGORY[topic]];
    if (setting === undefined) continue;
    for (const channel of NOTIFICATION_CHANNELS) {
      const value = channelValue(setting, channel);
      if (value !== undefined) (preferences[topic] ??= {})[channel] = value;
    }
  }
  // Categories from old spikes alone don't count as Cadence preferences.
  return Object.keys(preferences).length > 0 ? preferences : null;
}

function withChanges(
  categories: Categories,
  changes: NotificationPreferenceChanges
): Categories {
  const merged = { ...categories };
  for (const [topic, channels] of Object.entries(changes) as [
    NotificationTopic,
    Partial<Record<NotificationChannel, boolean>>,
  ][]) {
    const key = TOPIC_CATEGORY[topic];
    const current = merged[key];
    const setting: CategorySettingObject =
      current === undefined
        ? {}
        : typeof current === "boolean"
          ? {
              channel_types: Object.fromEntries(
                NOTIFICATION_CHANNELS.map((c) => [CHANNEL_TYPE[c], current])
              ),
            }
          : { ...current };
    const channelTypes = { ...setting.channel_types };
    for (const [channel, value] of Object.entries(channels) as [
      NotificationChannel,
      boolean,
    ][]) {
      channelTypes[CHANNEL_TYPE[channel]] = value;
    }
    merged[key] = { ...setting, channel_types: channelTypes };
  }
  return merged;
}

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

  async function readPreferenceSet(
    userId: number
  ): Promise<PreferenceSet | null> {
    try {
      return await knock().users.getPreferences(String(userId), PREFERENCE_SET);
    } catch (error) {
      if (error instanceof Knock.NotFoundError) return null;
      throw error;
    }
  }

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

    async identifyUser(person) {
      // An upsert of what a Feed row shows. Role is never synced.
      const { id, ...profile } = knockUser(person);
      await knock().users.update(id, profile);
    },

    async readPreferences(userId) {
      return toPreferences(await readPreferenceSet(userId));
    },

    async setPreferences(userId, changes) {
      const set = await readPreferenceSet(userId);
      await knock().users.setPreferences(String(userId), PREFERENCE_SET, {
        __persistence_strategy__: "replace",
        categories: withChanges(set?.categories ?? {}, changes),
        workflows: set?.workflows ?? null,
        channel_types: set?.channel_types ?? null,
        channels: set?.channels ?? null,
      });
    },
  };
}

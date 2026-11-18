import type { NotificationTopic } from "~/lib/notifications";

// ─── Notification Preferences (shared by server and browser) ───
// A Notification Preference is one Notification Topic turned on or off on one
// channel. They're stored as Topic × channel so email can be added later as
// another channel without a migration. v1 uses only the Feed channel.

export const NOTIFICATION_CHANNELS = ["feed"] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Every Notification Topic, in the order the settings card lists them. */
export const ALL_NOTIFICATION_TOPICS = [
  "refund-request-updates",
  "open-refund-requests",
  "seat-claims",
  "enrollments",
  "discussion-questions",
  "discussion-replies",
] as const satisfies readonly NotificationTopic[];

export type TopicPreference = Record<NotificationChannel, boolean>;

/** A person's complete set of Notification Preferences. */
export type NotificationPreferences = Record<NotificationTopic, TopicPreference>;

/** Some Topics, and on each some channels, to merge into an existing set. */
export type NotificationPreferenceChanges = Partial<
  Record<NotificationTopic, Partial<TopicPreference>>
>;

/** Every Topic on except Enrollments, which would flood a popular course's Instructor. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  "refund-request-updates": { feed: true },
  "open-refund-requests": { feed: true },
  "seat-claims": { feed: true },
  enrollments: { feed: false },
  "discussion-questions": { feed: true },
  "discussion-replies": { feed: true },
};

/** Fills every Topic and channel `changes` leaves out from the defaults. */
export function withDefaults(
  changes: NotificationPreferenceChanges | null
): NotificationPreferences {
  return Object.fromEntries(
    ALL_NOTIFICATION_TOPICS.map((topic) => [
      topic,
      { ...DEFAULT_NOTIFICATION_PREFERENCES[topic], ...changes?.[topic] },
    ])
  ) as NotificationPreferences;
}

/** Merges `changes` into `existing`, Topic by Topic and channel by channel. */
export function mergePreferences(
  existing: NotificationPreferenceChanges | null,
  changes: NotificationPreferenceChanges
): NotificationPreferenceChanges {
  const merged: NotificationPreferenceChanges = { ...existing };
  for (const [topic, channels] of Object.entries(changes) as [
    NotificationTopic,
    Partial<TopicPreference>,
  ][]) {
    merged[topic] = { ...merged[topic], ...channels };
  }
  return merged;
}

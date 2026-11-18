import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationChannel,
  mergePreferences,
  type NotificationPreferences,
  withDefaults,
} from "~/lib/notification-preferences";
import type { NotificationTopic } from "~/lib/notifications";
import type {
  NotificationPerson,
  NotificationsProvider,
} from "~/lib/notifications.server";

// ─── Users and their Notification Preferences at the provider ───
// Sync keeps the provider's copy of a user current (name, email, avatar) so
// Feed rows show the sender as they are now, and gives a first-time user the
// default Notification Preferences. Role is never synced.

/**
 * Identifies the user and writes the default Notification Preferences only if
 * they have none yet. Best-effort: a failure is logged, never thrown.
 */
export async function syncNotificationUser(
  provider: NotificationsProvider,
  person: NotificationPerson
): Promise<void> {
  try {
    await provider.identifyUser(person);
    if ((await provider.readPreferences(person.id)) === null) {
      await provider.setPreferences(person.id, DEFAULT_NOTIFICATION_PREFERENCES);
    }
  } catch (error) {
    console.error(`[notifications] Failed to sync user ${person.id}`, error);
  }
}

/**
 * The user's Notification Preferences for every Topic. Anything not stored
 * (a user never synced, a Topic added later) reads as its default.
 */
export async function readNotificationPreferences(
  provider: NotificationsProvider,
  userId: number
): Promise<NotificationPreferences> {
  return withDefaults(await provider.readPreferences(userId));
}

/**
 * Turns one Topic on or off on one channel, merging into the stored set so
 * every other Notification Preference is left alone. Throws on failure, so
 * the caller can tell the person it wasn't saved.
 */
export async function setNotificationPreference(
  provider: NotificationsProvider,
  userId: number,
  topic: NotificationTopic,
  enabled: boolean,
  channel: NotificationChannel = "feed"
): Promise<void> {
  const change = { [topic]: { [channel]: enabled } };
  // A user with no stored set gets the defaults too: at the provider an unset
  // Topic counts as on, which would switch Enrollments on.
  const stored = await provider.readPreferences(userId);
  await provider.setPreferences(
    userId,
    stored === null ? mergePreferences(DEFAULT_NOTIFICATION_PREFERENCES, change) : change
  );
}

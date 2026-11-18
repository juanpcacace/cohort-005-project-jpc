import { eq } from "drizzle-orm";
import type { Db } from "~/db";
import { users } from "~/db/schema";
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

/** A user row as the recipient or actor of a Notification. */
export function toNotificationPerson(
  user: typeof users.$inferSelect
): NotificationPerson {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
  };
}

/** The user with this id as a recipient or actor, or undefined if there is none. */
export function findNotificationPerson(
  db: Db,
  userId: number
): NotificationPerson | undefined {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  return user && toNotificationPerson(user);
}

/**
 * Identifies the user and writes the default Notification Preferences only if
 * they have none yet. Best-effort: a failure is logged, never thrown.
 */
export async function syncNotificationUser(
  notifications: NotificationsProvider,
  person: NotificationPerson
): Promise<void> {
  try {
    await notifications.identifyUser(person);
    if ((await notifications.readPreferences(person.id)) === null) {
      await notifications.setPreferences(person.id, DEFAULT_NOTIFICATION_PREFERENCES);
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
  notifications: NotificationsProvider,
  userId: number
): Promise<NotificationPreferences> {
  return withDefaults(await notifications.readPreferences(userId));
}

/**
 * Turns one Topic on or off on one channel, merging into the stored set so
 * every other Notification Preference is left alone. Throws on failure, so
 * the caller can tell the person it wasn't saved.
 */
export async function setNotificationPreference(
  notifications: NotificationsProvider,
  userId: number,
  topic: NotificationTopic,
  enabled: boolean,
  channel: NotificationChannel = "feed"
): Promise<void> {
  const change = { [topic]: { [channel]: enabled } };
  // A user with no stored set gets the defaults too: at the provider an unset
  // Topic counts as on, which would switch Enrollments on.
  const stored = await notifications.readPreferences(userId);
  await notifications.setPreferences(
    userId,
    stored === null ? mergePreferences(DEFAULT_NOTIFICATION_PREFERENCES, change) : change
  );
}

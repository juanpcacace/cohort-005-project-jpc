import { eq } from "drizzle-orm";
import { UserRole, users } from "~/db/schema";
import type { NotificationsProvider } from "~/lib/notifications.server";
import {
  syncNotificationUser,
  toNotificationPerson,
} from "~/lib/notification-users.server";
import type { Db } from "~/db";

// ─── Users ───
// Every write that changes what a Notification shows about a person (name,
// email, avatar) syncs them to the Notifications provider after it commits.
// Sync is best-effort and never fails the write. Role is never synced.
// Every function takes the database first, then the provider (project convention).

type UserRow = typeof users.$inferSelect;

/** Creates a Student at signup and syncs them with the default Notification Preferences. */
export async function signUpStudent(
  db: Db,
  notifications: NotificationsProvider,
  name: string,
  email: string
): Promise<UserRow> {
  const user = db
    .insert(users)
    .values({ name, email, role: UserRole.Student, avatarUrl: null })
    .returning()
    .get();
  await syncNotificationUser(notifications, toNotificationPerson(user));
  return user;
}

/** Saves a person's own profile from `/settings`. */
export async function updateProfile(
  db: Db,
  notifications: NotificationsProvider,
  userId: number,
  name: string,
  bio: string | null
): Promise<UserRow | undefined> {
  const user = db
    .update(users)
    .set({ name, bio })
    .where(eq(users.id, userId))
    .returning()
    .get();
  if (user) await syncNotificationUser(notifications, toNotificationPerson(user));
  return user;
}

/** A Platform Admin's edit of a user's name and email in `admin.users`. */
export async function updateUserDetails(
  db: Db,
  notifications: NotificationsProvider,
  userId: number,
  name: string,
  email: string
): Promise<UserRow | undefined> {
  const user = db
    .update(users)
    .set({ name, email })
    .where(eq(users.id, userId))
    .returning()
    .get();
  if (user) await syncNotificationUser(notifications, toNotificationPerson(user));
  return user;
}

/** Syncs every user, one at a time. For the seed and the backfill script. Returns how many. */
export async function syncAllNotificationUsers(
  db: Db,
  notifications: NotificationsProvider
): Promise<number> {
  const all = db.select().from(users).orderBy(users.id).all();
  for (const user of all) {
    await syncNotificationUser(notifications, toNotificationPerson(user));
  }
  return all.length;
}

import { eq } from "drizzle-orm";
import { coupons, courses, purchases, UserRole, users } from "~/db/schema";
import { ALL_NOTIFICATION_TOPICS } from "~/lib/notification-preferences";
import { z } from "zod";
import type { NotificationTopic } from "~/lib/notifications";
import type { NotificationsProvider } from "~/lib/notifications.server";
import { setNotificationPreference } from "~/lib/notification-users.server";
import type { Db } from "~/db";

// ─── The Notifications card on /settings ───
// A switch shows by what the person is or has, not by their role alone: a
// Topic they could never receive a Notification for stays hidden, and keeps
// its default.

/** The Topics whose switch the person sees, in the card's order. */
export function visibleNotificationTopics(
  db: Db,
  userId: number
): NotificationTopic[] {
  const role = db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get()?.role;
  // Enrollment and Discussion Question Notifications go to a course's
  // instructorId, whatever that person's role, so the switches follow that.
  const teachesACourse = !!db
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.instructorId, userId))
    .get();
  const hasPurchase = !!db
    .select({ id: purchases.id })
    .from(purchases)
    .where(eq(purchases.userId, userId))
    .get();
  // A Team Licence is a Purchase with Seats; its buyer is the Team Admin.
  const hasTeamLicence = !!db
    .select({ id: coupons.id })
    .from(coupons)
    .innerJoin(purchases, eq(coupons.purchaseId, purchases.id))
    .where(eq(purchases.userId, userId))
    .get();

  const visible: Record<NotificationTopic, boolean> = {
    "refund-request-updates": hasPurchase,
    "open-refund-requests": role === UserRole.Admin,
    "seat-claims": hasTeamLicence,
    enrollments: teachesACourse,
    "discussion-questions": teachesACourse,
    "discussion-replies": true,
  };
  return ALL_NOTIFICATION_TOPICS.filter((topic) => visible[topic]);
}

export const notificationPreferenceSchema = z.object({
  topic: z.enum(ALL_NOTIFICATION_TOPICS),
  enabled: z.boolean(),
});

export type SaveNotificationPreferenceResult =
  | { ok: true }
  | { ok: false; status: 400; error: string };

/**
 * Turns one Topic on or off for the person from the card's input, merging it
 * into their Notification Preferences. Throws when the provider fails.
 */
export async function saveNotificationPreference(
  db: Db,
  notifications: NotificationsProvider,
  userId: number,
  input: unknown
): Promise<SaveNotificationPreferenceResult> {
  const parsed = notificationPreferenceSchema.safeParse(input);
  if (
    !parsed.success ||
    !visibleNotificationTopics(db, userId).includes(parsed.data.topic)
  ) {
    return { ok: false, status: 400, error: "Invalid Notification Preference." };
  }
  const { topic, enabled } = parsed.data;
  await setNotificationPreference(notifications, userId, topic, enabled);
  return { ok: true };
}

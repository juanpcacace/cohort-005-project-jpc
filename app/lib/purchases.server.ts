import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import {
  coupons,
  enrollments,
  purchases,
  teamMembers,
  TeamMemberRole,
  teams,
} from "~/db/schema";
import { enrollStudent } from "~/lib/enrollments.server";
import type { NotificationsProvider } from "~/lib/notifications.server";
import type { Db } from "~/lib/refunds.server";

// ─── Purchase ───
// An Individual Purchase enrolls the buyer (and tells the Instructor). Buying
// a Team Licence creates its Seats and the buyer's team instead, and enrolls
// nobody, so it sends no Enrollment Notification.
//
// Takes the database first, then the Notifications provider, and `now` last
// (project convention).

export type PurchaseResult = {
  purchase: typeof purchases.$inferSelect;
  /** The buyer's Enrollment for an Individual Purchase; null for a Team Licence. */
  enrollment: typeof enrollments.$inferSelect | null;
  /** The Team Licence's Seats; empty for an Individual Purchase. */
  seats: (typeof coupons.$inferSelect)[];
};

/**
 * Records a Purchase. `seats` is null for an Individual Purchase, or the
 * number of Seats on a Team Licence.
 */
export async function completePurchase(
  db: Db,
  notifications: NotificationsProvider,
  buyerId: number,
  courseId: number,
  amountPaid: number,
  country: string | null,
  seats: number | null,
  now: Date
): Promise<PurchaseResult> {
  const purchase = db
    .insert(purchases)
    .values({
      userId: buyerId,
      courseId,
      amountPaid,
      country,
      createdAt: now.toISOString(),
    })
    .returning()
    .get();

  if (seats === null) {
    const enrollment = await enrollStudent(db, notifications, buyerId, courseId, now);
    return { purchase, enrollment, seats: [] };
  }

  const team = getOrCreateTeamForAdmin(db, buyerId);
  return {
    purchase,
    enrollment: null,
    seats: createSeats(db, team.id, courseId, purchase.id, seats),
  };
}

function getOrCreateTeamForAdmin(db: Db, userId: number) {
  const membership = db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.role, TeamMemberRole.Admin)
      )
    )
    .get();
  const existing =
    membership &&
    db.select().from(teams).where(eq(teams.id, membership.teamId)).get();
  if (existing) return existing;

  const team = db.insert(teams).values({}).returning().get();
  db.insert(teamMembers)
    .values({ teamId: team.id, userId, role: TeamMemberRole.Admin })
    .run();
  return team;
}

function createSeats(
  db: Db,
  teamId: number,
  courseId: number,
  purchaseId: number,
  quantity: number
) {
  return Array.from({ length: quantity }, () =>
    db
      .insert(coupons)
      .values({
        teamId,
        courseId,
        code: crypto.randomBytes(12).toString("base64url"),
        purchaseId,
      })
      .returning()
      .get()
  );
}

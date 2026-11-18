import { and, eq, isNull } from "drizzle-orm";
import { coupons, courses, enrollments, purchases } from "~/db/schema";
import { enrollStudent, findEnrollment } from "~/lib/enrollments.server";
import { findNotificationPerson } from "~/lib/notification-users.server";
import {
  sendNotification,
  type NotificationsProvider,
} from "~/lib/notifications.server";
import type { Db } from "~/db";
import { getSeatAvailability } from "~/lib/refunds.server";

// ─── Seat claim ───
// A Student claiming one Seat on a Team Licence by its code, which turns it
// into a Claimed Seat and gives them an Enrollment. The Team Admin who owns
// the Team Licence hears about each claim, with the Seats left.
//
// Takes the database first, then the Notifications provider, and `now` last
// (project convention).

export const SEAT_ON_HOLD =
  "This seat can't be claimed right now. Ask the person who shared it with you.";
export const SEAT_REFUNDED =
  "This seat is no longer available. Ask the person who shared it with you.";

export type ClaimSeatResult =
  | { ok: true; enrollment: typeof enrollments.$inferSelect }
  | { ok: false; error: string };

export function getSeatByCode(db: Db, code: string) {
  return db.select().from(coupons).where(eq(coupons.code, code)).get();
}

/**
 * Claims the Seat with this code for the Student. `userCountry` must match the
 * Team Licence's country when it has one (empty string when unknown).
 */
export async function claimSeat(
  db: Db,
  notifications: NotificationsProvider,
  code: string,
  userId: number,
  userCountry: string,
  now: Date
): Promise<ClaimSeatResult> {
  const seat = getSeatByCode(db, code);
  if (!seat) {
    return { ok: false, error: "Coupon not found" };
  }

  if (seat.redeemedByUserId !== null) {
    return { ok: false, error: "Coupon has already been redeemed" };
  }

  const availability = getSeatAvailability(db, seat);
  if (availability === "on_hold") {
    return { ok: false, error: SEAT_ON_HOLD };
  }
  if (availability === "refunded") {
    return { ok: false, error: SEAT_REFUNDED };
  }

  if (findEnrollment(db, userId, seat.courseId)) {
    return { ok: false, error: "You are already enrolled in this course" };
  }

  const purchase = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, seat.purchaseId))
    .get();

  if (purchase?.country && purchase.country !== userCountry) {
    return {
      ok: false,
      error:
        "This coupon can only be redeemed from the same country as the purchaser",
    };
  }

  db.update(coupons)
    .set({ redeemedByUserId: userId, redeemedAt: now.toISOString() })
    .where(eq(coupons.id, seat.id))
    .run();

  const enrollment = await enrollStudent(
    db,
    notifications,
    userId,
    seat.courseId,
    now
  );

  if (purchase) {
    await notifySeatClaimed(db, notifications, seat, purchase.userId, userId);
  }

  return { ok: true, enrollment };
}

/**
 * Tells the Team Admin who bought the Team Licence that a Seat was claimed.
 * One per claim; there is no "all claimed" Notification. A Team Admin
 * claiming a Seat themselves hears nothing.
 */
async function notifySeatClaimed(
  db: Db,
  notifications: NotificationsProvider,
  seat: typeof coupons.$inferSelect,
  teamAdminId: number,
  claimerId: number
) {
  // Nobody is notified of their own action: a Team Admin claiming a Seat on
  // their own Team Licence hears nothing.
  if (teamAdminId === claimerId) return;

  const teamAdmin = findNotificationPerson(db, teamAdminId);
  const claimer = findNotificationPerson(db, claimerId);
  const course = db.select().from(courses).where(eq(courses.id, seat.courseId)).get();
  if (!teamAdmin || !claimer || !course) return;

  const seatsLeft = db
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(
        eq(coupons.purchaseId, seat.purchaseId),
        isNull(coupons.redeemedByUserId),
        isNull(coupons.refundedAt)
      )
    )
    .all().length;

  await sendNotification(notifications, {
    kind: "seat-claimed",
    recipients: [teamAdmin],
    actor: claimer,
    data: {
      seatId: seat.id,
      purchaseId: seat.purchaseId,
      courseTitle: course.title,
      seatsLeft,
    },
    idempotencyKey: `seat-claimed:${seat.id}`,
    cause: null,
  });
}

import { and, eq } from "drizzle-orm";
import { courses, enrollments, users } from "~/db/schema";
import {
  sendNotification,
  type NotificationPerson,
  type NotificationsProvider,
} from "~/lib/notifications.server";
import type { Db } from "~/lib/refunds.server";

// ─── Enrollment ───
// Giving a Student their Enrollment on a course, after an Individual Purchase
// or a Claimed Seat. A Lapsed Student has no Enrollment, so they enroll again
// the same way. Buying a Team Licence never enrolls the buyer, so it never
// reaches here and never sends an Enrollment Notification.
//
// Takes the database first, then the Notifications provider, and `now` last
// (project convention).

export function findEnrollment(db: Db, userId: number, courseId: number) {
  return db
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();
}

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

/**
 * Throws if the Student already has an Enrollment or the course is missing.
 * After the Enrollment is written, tells the course's Instructor (best-effort;
 * the Instructor only gets it if they opted in to the Enrollments Topic).
 */
export async function enrollStudent(
  db: Db,
  notifications: NotificationsProvider,
  userId: number,
  courseId: number,
  now: Date
) {
  if (findEnrollment(db, userId, courseId)) {
    throw new Error("User is already enrolled in this course");
  }

  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!course) {
    throw new Error("Course not found");
  }

  const enrollment = db
    .insert(enrollments)
    .values({ userId, courseId, enrolledAt: now.toISOString() })
    .returning()
    .get();

  // Nobody is notified of their own action: an Instructor enrolling in their
  // own course hears nothing.
  if (course.instructorId !== userId) {
    const student = db.select().from(users).where(eq(users.id, userId)).get();
    const instructor = db
      .select()
      .from(users)
      .where(eq(users.id, course.instructorId))
      .get();
    if (student && instructor) {
      await sendNotification(notifications, {
        kind: "enrollment",
        recipients: [toNotificationPerson(instructor)],
        actor: toNotificationPerson(student),
        data: { courseId: course.id, courseTitle: course.title },
        idempotencyKey: `enrollment:${enrollment.id}`,
        cause: null,
      });
    }
  }

  return enrollment;
}

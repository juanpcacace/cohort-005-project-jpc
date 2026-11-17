import { and, eq } from "drizzle-orm";
import { courses, enrollments } from "~/db/schema";
import type { Db } from "~/lib/refunds.server";

// ─── Enrollment ───
// Giving a Student their Enrollment on a course, after an Individual Purchase
// or a Claimed Seat. A Lapsed Student has no Enrollment, so they enroll again
// the same way. Buying a Team Licence never enrolls the buyer.
//
// Takes the database first and `now` last (project convention).

export function findEnrollment(db: Db, userId: number, courseId: number) {
  return db
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();
}

/** Throws if the Student already has an Enrollment or the course is missing. */
export function enrollStudent(
  db: Db,
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

  return db
    .insert(enrollments)
    .values({ userId, courseId, enrolledAt: now.toISOString() })
    .returning()
    .get();
}

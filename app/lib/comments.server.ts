import { eq } from "drizzle-orm";
import { comments, courses, lessons, modules, users } from "~/db/schema";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";
import { toSnippet } from "~/lib/notifications";
import {
  archiveNotifications,
  type NotificationPerson,
  type NotificationsProvider,
  sendNotification,
} from "~/lib/notifications.server";
import type { Db } from "~/lib/refunds.server";

// ─── Comments ───
// Discussion Questions (top-level comments) and Discussion Replies (one level
// below a question). The lesson page and the Instructor questions page both
// write through here.
//
// Every function takes the database first and `now` last, so tests can hand in
// an in-memory database and a fixed clock. Functions that send Notifications
// take the provider second, after the database. Positional parameters
// (project convention). Notifications go out after the write commits and
// never fail it.

type Comment = typeof comments.$inferSelect;

export function getComment(db: Db, commentId: number) {
  return db.select().from(comments).where(eq(comments.id, commentId)).get();
}

function getPerson(db: Db, userId: number): NotificationPerson | undefined {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();
}

function getCourseForLesson(db: Db, lessonId: number) {
  return db
    .select({
      courseId: courses.id,
      courseSlug: courses.slug,
      instructorId: courses.instructorId,
      lessonTitle: lessons.title,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, lessonId))
    .get();
}

type LessonCourse = NonNullable<ReturnType<typeof getCourseForLesson>>;

function assertValidBody(body: string) {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    throw new Error("Comment cannot be empty");
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new Error(
      `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`
    );
  }
  return trimmed;
}

/**
 * Posts a Discussion Question (`parentId` null) or a Discussion Reply. A
 * question notifies the course's Instructor and a reply the question's author,
 * unless they wrote it themselves.
 */
export async function createComment(
  db: Db,
  notifications: NotificationsProvider,
  userId: number,
  lessonId: number,
  parentId: number | null,
  body: string,
  now: Date
) {
  const trimmed = assertValidBody(body);

  const course = getCourseForLesson(db, lessonId);
  if (!course) {
    throw new Error("Lesson not found");
  }

  let question: Comment | undefined;
  if (parentId !== null) {
    question = getComment(db, parentId);
    if (!question) {
      throw new Error("Parent comment not found");
    }
    if (question.lessonId !== lessonId) {
      throw new Error("Parent comment belongs to a different lesson");
    }
    if (question.parentId !== null) {
      throw new Error("Replies can only be one level deep");
    }
  }

  const comment = db
    .insert(comments)
    .values({
      userId,
      lessonId,
      parentId,
      body: trimmed,
      createdAt: now.toISOString(),
    })
    .returning()
    .get();

  if (question && question.userId !== userId) {
    await notifyDiscussionReply(db, notifications, comment, question, course);
  }
  if (!question && course.instructorId !== userId) {
    await notifyDiscussionQuestion(db, notifications, comment, course);
  }

  return comment;
}

async function notifyDiscussionQuestion(
  db: Db,
  notifications: NotificationsProvider,
  question: Comment,
  course: LessonCourse
) {
  const instructor = getPerson(db, course.instructorId);
  if (!instructor) return;

  await sendNotification(notifications, {
    kind: "discussion-question",
    recipients: [instructor],
    actor: getPerson(db, question.userId) ?? null,
    data: {
      commentId: question.id,
      lessonId: question.lessonId,
      lessonTitle: course.lessonTitle,
      courseSlug: course.courseSlug,
      snippet: toSnippet(question.body),
    },
    idempotencyKey: `discussion-question:${question.id}`,
    cause: { commentId: question.id },
  });
}

async function notifyDiscussionReply(
  db: Db,
  notifications: NotificationsProvider,
  reply: Comment,
  question: Comment,
  course: LessonCourse
) {
  const asker = getPerson(db, question.userId);
  if (!asker) return;

  await sendNotification(notifications, {
    kind: "discussion-reply",
    recipients: [asker],
    actor: getPerson(db, reply.userId) ?? null,
    data: {
      commentId: reply.id,
      questionId: question.id,
      lessonId: reply.lessonId,
      lessonTitle: course.lessonTitle,
      courseSlug: course.courseSlug,
      snippet: toSnippet(reply.body),
    },
    idempotencyKey: `discussion-reply:${reply.id}`,
    cause: { commentId: reply.id },
  });
}

/** Changes the body of the author's own comment. */
export function updateComment(
  db: Db,
  commentId: number,
  userId: number,
  body: string,
  now: Date
) {
  const trimmed = assertValidBody(body);

  const existing = getComment(db, commentId);
  if (!existing) {
    throw new Error("Comment not found");
  }
  if (existing.deletedAt !== null) {
    throw new Error("Comment has been deleted");
  }
  if (existing.userId !== userId) {
    throw new Error("You can only edit your own comments");
  }

  return db
    .update(comments)
    .set({ body: trimmed, editedAt: now.toISOString() })
    .where(eq(comments.id, commentId))
    .returning()
    .get();
}

/**
 * Soft-deletes a comment by setting `deletedAt`. The author or staff (the
 * course's Instructor or a Platform Admin) may delete. Deleting twice keeps
 * the first time. The Notification the comment caused leaves its recipient's
 * Feed; deleting a question leaves its replies' Notifications alone.
 */
export async function deleteComment(
  db: Db,
  notifications: NotificationsProvider,
  commentId: number,
  userId: number,
  isStaff: boolean,
  now: Date
) {
  const existing = getComment(db, commentId);
  if (!existing) {
    throw new Error("Comment not found");
  }
  if (existing.userId !== userId && !isStaff) {
    throw new Error("You can only delete your own comments");
  }
  if (existing.deletedAt !== null) {
    return existing;
  }

  const deleted = db
    .update(comments)
    .set({ deletedAt: now.toISOString() })
    .where(eq(comments.id, commentId))
    .returning()
    .get()!;

  await archiveNotifications(notifications, { commentId });

  return deleted;
}

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { createComment, deleteComment, getComment } from "./comments.server";
import {
  fakeProvider,
  type FakeProvider,
  type NotificationsProvider,
  readFeedRows,
} from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let notifications: FakeProvider;

beforeEach(() => {
  notifications = fakeProvider(() => NOW);
  db = createTestDb();
  base = seedBaseData(db);
  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();
  lessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson 1", position: 1 })
    .returning()
    .get().id;
});

function addStudent(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: UserRole.Student,
    })
    .returning()
    .get();
}

describe("createComment", () => {
  it("creates a Discussion Question with a trimmed body", async () => {
    const question = await createComment(
      db,
      notifications,
      base.user.id,
      lessonId,
      null,
      "  How do closures work?  ",
      NOW
    );

    expect(question).toMatchObject({
      userId: base.user.id,
      lessonId,
      parentId: null,
      body: "How do closures work?",
      createdAt: NOW.toISOString(),
      deletedAt: null,
    });
  });

  it("creates a Discussion Reply under a Discussion Question", async () => {
    const question = await createComment(db, notifications, base.user.id, lessonId, null, "Why?", NOW);

    const reply = await createComment(
      db,
      notifications,
      base.instructor.id,
      lessonId,
      question.id,
      "Because.",
      NOW
    );

    expect(reply).toMatchObject({
      userId: base.instructor.id,
      lessonId,
      parentId: question.id,
      body: "Because.",
    });
  });

  it("refuses a reply to a Discussion Reply", async () => {
    const question = await createComment(db, notifications, base.user.id, lessonId, null, "Why?", NOW);
    const reply = await createComment(db, notifications, base.instructor.id, lessonId, question.id, "Because.", NOW);

    await expect(
      createComment(db, notifications, base.user.id, lessonId, reply.id, "But why?", NOW)
    ).rejects.toThrow("Replies can only be one level deep");
  });

  it("refuses an empty comment", async () => {
    await expect(
      createComment(db, notifications, base.user.id, lessonId, null, "   ", NOW)
    ).rejects.toThrow("Comment cannot be empty");
  });
});

describe("Discussion Reply Notifications", () => {
  it("sends discussion-reply to the question's author", async () => {
    const question = await createComment(db, notifications, base.user.id, lessonId, null, "Why?", NOW);

    const reply = await createComment(
      db,
      notifications,
      base.instructor.id,
      lessonId,
      question.id,
      "Because **closures** capture `scope`.",
      NOW
    );

    expect(notifications.sent).toEqual([
      {
        kind: "discussion-reply",
        recipients: [
          {
            id: base.user.id,
            name: "Test User",
            email: "test@example.com",
            avatarUrl: null,
          },
        ],
        actor: {
          id: base.instructor.id,
          name: "Test Instructor",
          email: "instructor@example.com",
          avatarUrl: null,
        },
        data: {
          commentId: reply.id,
          questionId: question.id,
          lessonId,
          lessonTitle: "Lesson 1",
          courseSlug: base.course.slug,
          snippet: "Because closures capture scope.",
        },
        idempotencyKey: `discussion-reply:${reply.id}`,
        cause: { commentId: reply.id },
      },
    ]);
  });

  it("sends nothing when the author replies to their own question", async () => {
    const question = await createComment(db, notifications, base.user.id, lessonId, null, "Why?", NOW);

    await createComment(db, notifications, base.user.id, lessonId, question.id, "Never mind, got it.", NOW);

    expect(notifications.sent).toEqual([]);
  });

  it("notifies only the asker, not others in the thread", async () => {
    const riley = addStudent("Riley");
    const sam = addStudent("Sam");
    const question = await createComment(db, notifications, base.user.id, lessonId, null, "Why?", NOW);
    await createComment(db, notifications, riley.id, lessonId, question.id, "Same question!", NOW);

    await createComment(db, notifications, sam.id, lessonId, question.id, "Here's why.", NOW);

    expect(
      notifications.sent.map((n) => n.recipients.map((r) => r.id))
    ).toEqual([[base.user.id], [base.user.id]]);
  });

  it("sends nothing for a Discussion Question", async () => {
    await createComment(db, notifications, base.user.id, lessonId, null, "Why?", NOW);

    expect(notifications.sent).toEqual([]);
  });

  it("saves the reply when the provider throws", async () => {
    const question = await createComment(db, notifications, base.user.id, lessonId, null, "Why?", NOW);
    const broken: NotificationsProvider = {
      ...notifications,
      send: async () => {
        throw new Error("Knock is down");
      },
    };

    const reply = await createComment(db, broken, base.instructor.id, lessonId, question.id, "Because.", NOW);

    expect(reply).toMatchObject({ parentId: question.id, body: "Because." });
    expect(getComment(db, reply.id)).toBeDefined();
  });

  it("shows the reply in the asker's Notification Feed, linked to the comment", async () => {
    const question = await createComment(db, notifications, base.user.id, lessonId, null, "Why?", NOW);
    const reply = await createComment(db, notifications, base.instructor.id, lessonId, question.id, "Because.", NOW);

    const page = await readFeedRows(notifications, base.user.id, null, 20);

    expect(page.rows).toMatchObject([
      {
        kind: "discussion-reply",
        topic: "discussion-replies",
        actor: { name: "Test Instructor", avatarUrl: null },
        title: "Test Instructor replied to your question",
        snippet: "Because.",
        link: `/courses/${base.course.slug}/lessons/${lessonId}#comment-${reply.id}`,
        seen: false,
        read: false,
      },
    ]);
    expect(await notifications.readCounts(base.user.id)).toEqual({ unseen: 1, unread: 1 });
    expect((await readFeedRows(notifications, base.instructor.id, null, 20)).rows).toEqual([]);
  });
});

describe("deleteComment", () => {
  const LATER = new Date(2026, 9, 7, 9, 0, 0);

  it("soft-deletes the author's own comment", async () => {
    const question = await createComment(db, notifications, base.user.id, lessonId, null, "Why?", NOW);

    const deleted = deleteComment(db, question.id, base.user.id, false, LATER);

    expect(deleted).toMatchObject({
      id: question.id,
      body: "Why?",
      deletedAt: LATER.toISOString(),
    });
  });

  it("lets staff delete someone else's comment", async () => {
    const question = await createComment(db, notifications, base.user.id, lessonId, null, "Why?", NOW);

    const deleted = deleteComment(db, question.id, base.instructor.id, true, LATER);

    expect(deleted.deletedAt).toBe(LATER.toISOString());
  });

  it("refuses a Student deleting someone else's comment", async () => {
    const other = addStudent("Riley");
    const question = await createComment(db, notifications, base.user.id, lessonId, null, "Why?", NOW);

    expect(() =>
      deleteComment(db, question.id, other.id, false, LATER)
    ).toThrow("You can only delete your own comments");
  });

  it("keeps the first deletion time when deleted again", async () => {
    const question = await createComment(db, notifications, base.user.id, lessonId, null, "Why?", NOW);
    deleteComment(db, question.id, base.user.id, false, LATER);

    const again = deleteComment(
      db,
      question.id,
      base.user.id,
      false,
      new Date(2026, 9, 8)
    );

    expect(again.deletedAt).toBe(LATER.toISOString());
  });
});

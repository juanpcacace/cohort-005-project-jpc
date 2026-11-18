import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import {
  createComment,
  deleteComment,
  getComment,
  updateComment,
} from "./comments.server";
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
  const replyNotifications = () =>
    notifications.sent.filter((n) => n.kind === "discussion-reply");

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

    expect(replyNotifications()).toEqual([
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

    expect(replyNotifications()).toEqual([]);
  });

  it("notifies only the asker, not others in the thread", async () => {
    const riley = addStudent("Riley");
    const sam = addStudent("Sam");
    const question = await createComment(db, notifications, base.user.id, lessonId, null, "Why?", NOW);
    await createComment(db, notifications, riley.id, lessonId, question.id, "Same question!", NOW);

    await createComment(db, notifications, sam.id, lessonId, question.id, "Here's why.", NOW);

    expect(
      replyNotifications().map((n) => n.recipients.map((r) => r.id))
    ).toEqual([[base.user.id], [base.user.id]]);
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
    const instructorRows = (await readFeedRows(notifications, base.instructor.id, null, 20)).rows;
    expect(instructorRows.filter((r) => r.kind === "discussion-reply")).toEqual([]);
  });
});

describe("Discussion Question Notifications", () => {
  it("sends discussion-question to the course's Instructor", async () => {
    const question = await createComment(
      db,
      notifications,
      base.user.id,
      lessonId,
      null,
      "How do **closures** work?",
      NOW
    );

    expect(notifications.sent).toEqual([
      {
        kind: "discussion-question",
        recipients: [
          {
            id: base.instructor.id,
            name: "Test Instructor",
            email: "instructor@example.com",
            avatarUrl: null,
          },
        ],
        actor: {
          id: base.user.id,
          name: "Test User",
          email: "test@example.com",
          avatarUrl: null,
        },
        data: {
          commentId: question.id,
          lessonId,
          lessonTitle: "Lesson 1",
          courseSlug: base.course.slug,
          snippet: "How do closures work?",
        },
        idempotencyKey: `discussion-question:${question.id}`,
        cause: { commentId: question.id },
      },
    ]);
  });

  it("shows the question in the Instructor's Notification Feed, linked to the comment", async () => {
    const question = await createComment(db, notifications, base.user.id, lessonId, null, "Why?", NOW);

    const page = await readFeedRows(notifications, base.instructor.id, null, 20);

    expect(page.rows).toMatchObject([
      {
        kind: "discussion-question",
        topic: "discussion-questions",
        actor: { name: "Test User", avatarUrl: null },
        title: "Test User asked a question on Lesson 1",
        snippet: "Why?",
        link: `/courses/${base.course.slug}/lessons/${lessonId}#comment-${question.id}`,
      },
    ]);
  });

  it("sends nothing when the Instructor asks on their own course", async () => {
    await createComment(db, notifications, base.instructor.id, lessonId, null, "Any questions?", NOW);

    expect(notifications.sent).toEqual([]);
  });

  it("still notifies the Instructor when a Platform Admin asks", async () => {
    const admin = db
      .insert(schema.users)
      .values({ name: "Ada Admin", email: "ada@example.com", role: UserRole.Admin })
      .returning()
      .get();

    await createComment(db, notifications, admin.id, lessonId, null, "Is this current?", NOW);

    expect(notifications.sent.map((n) => [n.kind, n.recipients.map((r) => r.id)])).toEqual([
      ["discussion-question", [base.instructor.id]],
    ]);
  });

  it("saves the question when the provider throws", async () => {
    const broken: NotificationsProvider = {
      ...notifications,
      send: async () => {
        throw new Error("Knock is down");
      },
    };

    const question = await createComment(db, broken, base.user.id, lessonId, null, "Why?", NOW);

    expect(getComment(db, question.id)).toMatchObject({ body: "Why?" });
  });
});

describe("deleteComment", () => {
  const LATER = new Date(2026, 9, 7, 9, 0, 0);

  it("soft-deletes the author's own comment", async () => {
    const question = await createComment(db, notifications, base.user.id, lessonId, null, "Why?", NOW);

    const deleted = await deleteComment(db, notifications, question.id, base.user.id, false, LATER);

    expect(deleted).toMatchObject({
      id: question.id,
      body: "Why?",
      deletedAt: LATER.toISOString(),
    });
  });

  it("lets staff delete someone else's comment", async () => {
    const question = await createComment(db, notifications, base.user.id, lessonId, null, "Why?", NOW);

    const deleted = await deleteComment(db, notifications, question.id, base.instructor.id, true, LATER);

    expect(deleted.deletedAt).toBe(LATER.toISOString());
  });

  it("refuses a Student deleting someone else's comment", async () => {
    const other = addStudent("Riley");
    const question = await createComment(db, notifications, base.user.id, lessonId, null, "Why?", NOW);

    await expect(
      deleteComment(db, notifications, question.id, other.id, false, LATER)
    ).rejects.toThrow("You can only delete your own comments");
  });

  it("keeps the first deletion time when deleted again", async () => {
    const question = await createComment(db, notifications, base.user.id, lessonId, null, "Why?", NOW);
    await deleteComment(db, notifications, question.id, base.user.id, false, LATER);

    const again = await deleteComment(
      db,
      notifications,
      question.id,
      base.user.id,
      false,
      new Date(2026, 9, 8)
    );

    expect(again.deletedAt).toBe(LATER.toISOString());
  });
});

describe("Archiving Notifications when a comment is deleted", () => {
  const LATER = new Date(2026, 9, 7, 9, 0, 0);

  const feedKinds = async (userId: number) =>
    (await readFeedRows(notifications, userId, null, 20)).rows.map((r) => r.kind);

  it("removes the question from the Instructor's Feed when the question is deleted", async () => {
    const question = await createComment(db, notifications, base.user.id, lessonId, null, "Why?", NOW);

    await deleteComment(db, notifications, question.id, base.user.id, false, LATER);

    expect(await feedKinds(base.instructor.id)).toEqual([]);
    expect(await notifications.readCounts(base.instructor.id)).toEqual({ unseen: 0, unread: 0 });
  });

  it("removes the reply from the asker's Feed when the reply is deleted", async () => {
    const question = await createComment(db, notifications, base.user.id, lessonId, null, "Why?", NOW);
    const reply = await createComment(db, notifications, base.instructor.id, lessonId, question.id, "Because.", NOW);

    await deleteComment(db, notifications, reply.id, base.instructor.id, true, LATER);

    expect(await feedKinds(base.user.id)).toEqual([]);
    expect(await feedKinds(base.instructor.id)).toEqual(["discussion-question"]);
  });

  it("keeps reply Notifications when their question is deleted", async () => {
    const riley = addStudent("Riley");
    const question = await createComment(db, notifications, base.user.id, lessonId, null, "Why?", NOW);
    await createComment(db, notifications, riley.id, lessonId, question.id, "Here's why.", NOW);

    await deleteComment(db, notifications, question.id, base.instructor.id, true, LATER);

    expect(await feedKinds(base.user.id)).toEqual(["discussion-reply"]);
    expect(await feedKinds(base.instructor.id)).toEqual([]);
  });

  it("leaves Notifications as sent when a comment is edited", async () => {
    const question = await createComment(db, notifications, base.user.id, lessonId, null, "Why?", NOW);

    updateComment(db, question.id, base.user.id, "Why, exactly?", LATER);

    const page = await readFeedRows(notifications, base.instructor.id, null, 20);
    expect(page.rows.map((r) => r.snippet)).toEqual(["Why?"]);
  });

  it("deletes the comment when the provider throws on archive", async () => {
    const question = await createComment(db, notifications, base.user.id, lessonId, null, "Why?", NOW);
    const broken: NotificationsProvider = {
      ...notifications,
      archive: async () => {
        throw new Error("Knock is down");
      },
    };

    const deleted = await deleteComment(db, broken, question.id, base.user.id, false, LATER);

    expect(deleted.deletedAt).toBe(LATER.toISOString());
    expect(getComment(db, question.id)?.deletedAt).toBe(LATER.toISOString());
  });
});

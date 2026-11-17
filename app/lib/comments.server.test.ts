import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { createComment, deleteComment } from "./comments.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;

beforeEach(() => {
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
  it("creates a Discussion Question with a trimmed body", () => {
    const question = createComment(
      db,
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

  it("creates a Discussion Reply under a Discussion Question", () => {
    const question = createComment(db, base.user.id, lessonId, null, "Why?", NOW);

    const reply = createComment(
      db,
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

  it("refuses a reply to a Discussion Reply", () => {
    const question = createComment(db, base.user.id, lessonId, null, "Why?", NOW);
    const reply = createComment(db, base.instructor.id, lessonId, question.id, "Because.", NOW);

    expect(() =>
      createComment(db, base.user.id, lessonId, reply.id, "But why?", NOW)
    ).toThrow("Replies can only be one level deep");
  });

  it("refuses an empty comment", () => {
    expect(() =>
      createComment(db, base.user.id, lessonId, null, "   ", NOW)
    ).toThrow("Comment cannot be empty");
  });
});

describe("deleteComment", () => {
  const LATER = new Date(2026, 9, 7, 9, 0, 0);

  it("soft-deletes the author's own comment", () => {
    const question = createComment(db, base.user.id, lessonId, null, "Why?", NOW);

    const deleted = deleteComment(db, question.id, base.user.id, false, LATER);

    expect(deleted).toMatchObject({
      id: question.id,
      body: "Why?",
      deletedAt: LATER.toISOString(),
    });
  });

  it("lets staff delete someone else's comment", () => {
    const question = createComment(db, base.user.id, lessonId, null, "Why?", NOW);

    const deleted = deleteComment(db, question.id, base.instructor.id, true, LATER);

    expect(deleted.deletedAt).toBe(LATER.toISOString());
  });

  it("refuses a Student deleting someone else's comment", () => {
    const other = addStudent("Riley");
    const question = createComment(db, base.user.id, lessonId, null, "Why?", NOW);

    expect(() =>
      deleteComment(db, question.id, other.id, false, LATER)
    ).toThrow("You can only delete your own comments");
  });

  it("keeps the first deletion time when deleted again", () => {
    const question = createComment(db, base.user.id, lessonId, null, "Why?", NOW);
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

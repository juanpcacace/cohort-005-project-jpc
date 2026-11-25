import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: TestDb;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

const { getLessonQuiz } = await import("../quiz.server");

// The module has no writer for courses, lessons or quizzes (authoring lives
// elsewhere), so the rows go in directly, in this one block.
function addLessonWithQuiz(courseId: number, position: number) {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId, title: `Module ${position}`, position })
    .returning()
    .get();
  const lesson = testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: `Lesson ${position}`, position })
    .returning()
    .get();
  const quiz = testDb
    .insert(schema.quizzes)
    .values({
      lessonId: lesson.id,
      title: `Quiz ${position}`,
      passingScore: 0.7,
    })
    .returning()
    .get();
  return { lesson, quiz };
}

describe("getLessonQuiz", () => {
  let courseId: number;

  beforeEach(() => {
    testDb = createTestDb();
    courseId = seedBaseData(testDb).course.id;
  });

  it("finds the quiz that belongs to the lesson", () => {
    const { lesson, quiz } = addLessonWithQuiz(courseId, 1);
    expect(getLessonQuiz(lesson.id, quiz.id)).toEqual(quiz);
  });

  it("does not find another lesson's quiz by its id", () => {
    const { lesson } = addLessonWithQuiz(courseId, 1);
    const other = addLessonWithQuiz(courseId, 2);
    expect(getLessonQuiz(lesson.id, other.quiz.id)).toBeUndefined();
  });
});

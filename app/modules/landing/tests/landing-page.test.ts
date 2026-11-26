import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { CourseStatus, UserRole } from "~/db/schema";
import { markdown } from "~/lib/text";

let testDb: TestDb;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

const { getLandingPage } = await import("../index.server");

let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  testDb = createTestDb();
  base = seedBaseData(testDb);
});

// ─── Fixtures ───
// Course authoring lives elsewhere and this module only reads, so rows go in
// directly, in this one block.

let counter = 0;

function addCourse(
  overrides: Partial<typeof schema.courses.$inferInsert> = {}
) {
  counter += 1;
  return testDb
    .insert(schema.courses)
    .values({
      title: `Course ${counter}`,
      slug: `course-${counter}`,
      description: `About course ${counter}`,
      salesCopy: markdown(`Course ${counter}`),
      instructorId: base.instructor.id,
      categoryId: base.category.id,
      status: CourseStatus.Published,
      createdAt: new Date(Date.UTC(2099, 0, counter)).toISOString(),
      ...overrides,
    })
    .returning()
    .get();
}

function addLessons(courseId: number, perModule: number[]) {
  perModule.forEach((count, index) => {
    const mod = testDb
      .insert(schema.modules)
      .values({ courseId, title: `Module ${index}`, position: index })
      .returning()
      .get();
    for (let position = 0; position < count; position += 1) {
      testDb
        .insert(schema.lessons)
        .values({ moduleId: mod.id, title: `Lesson ${position}`, position })
        .run();
    }
  });
}

function addInstructor(name: string) {
  return testDb
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: UserRole.Instructor,
    })
    .returning()
    .get();
}

function addCategory(slug: string) {
  return testDb
    .insert(schema.categories)
    .values({ name: slug, slug })
    .returning()
    .get();
}

describe("getLandingPage featured courses", () => {
  it("features the three newest published courses, newest first", () => {
    addCourse({ title: "Oldest" });
    addCourse({ title: "Middle" });
    addCourse({ title: "Newer" });
    addCourse({ title: "Newest" });

    const titles = getLandingPage().featuredCourses.map((c) => c.title);

    expect(titles).toEqual(["Newest", "Newer", "Middle"]);
  });

  it("leaves out drafts and archived courses", () => {
    addCourse({ title: "Draft", status: CourseStatus.Draft });
    addCourse({ title: "Archived", status: CourseStatus.Archived });

    const titles = getLandingPage().featuredCourses.map((c) => c.title);

    expect(titles).toEqual(["Test Course"]);
  });

  it("counts lessons across every module of the course", () => {
    const course = addCourse({ title: "Counted" });
    addLessons(course.id, [2, 3]);
    addLessons(base.course.id, [4]);

    const featured = getLandingPage().featuredCourses;

    expect(featured.find((c) => c.id === course.id)?.lessonCount).toBe(5);
    expect(featured.find((c) => c.id === base.course.id)?.lessonCount).toBe(4);
  });

  it("reports zero lessons for a course with none", () => {
    expect(getLandingPage().featuredCourses[0]).toMatchObject({
      title: "Test Course",
      lessonCount: 0,
      categoryName: "Programming",
    });
  });
});

describe("getLandingPage stats", () => {
  it("counts only what is published", () => {
    const other = addInstructor("Olive");
    const design = addCategory("design");
    const draftOnly = addCategory("draft-only");
    const second = addCourse({ instructorId: other.id, categoryId: design.id });
    addLessons(second.id, [3]);
    addLessons(base.course.id, [1, 1]);
    const draft = addCourse({
      status: CourseStatus.Draft,
      instructorId: addInstructor("Dan").id,
      categoryId: draftOnly.id,
    });
    addLessons(draft.id, [7]);

    expect(getLandingPage().stats).toEqual({
      courses: 2,
      lessons: 5,
      instructors: 2,
      categories: 2,
    });
  });

  it("is all zeros with nothing published", () => {
    testDb = createTestDb();

    expect(getLandingPage()).toEqual({
      featuredCourses: [],
      stats: { courses: 0, lessons: 0, instructors: 0, categories: 0 },
    });
  });
});

import { countDistinct, desc, eq, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import {
  CourseStatus,
  categories,
  courses,
  lessons,
  modules,
  users,
} from "~/db/schema";

type Db = BetterSQLite3Database<typeof schema>;

export const FEATURED_COURSE_LIMIT = 3;

export type FeaturedCourse = {
  id: number;
  title: string;
  slug: string;
  description: string;
  coverImageUrl: string | null;
  instructorName: string;
  categoryName: string;
  lessonCount: number;
};

export type LandingStats = {
  courses: number;
  lessons: number;
  instructors: number;
  categories: number;
};

export type LandingPage = {
  featuredCourses: FeaturedCourse[];
  stats: LandingStats;
};

const published = eq(courses.status, CourseStatus.Published);

function readFeaturedCourses(db: Db): FeaturedCourse[] {
  return db
    .select({
      id: courses.id,
      title: courses.title,
      slug: courses.slug,
      description: courses.description,
      coverImageUrl: courses.coverImageUrl,
      instructorName: users.name,
      categoryName: categories.name,
      lessonCount: sql<number>`count(${lessons.id})`,
    })
    .from(courses)
    .innerJoin(users, eq(courses.instructorId, users.id))
    .innerJoin(categories, eq(courses.categoryId, categories.id))
    .leftJoin(modules, eq(modules.courseId, courses.id))
    .leftJoin(lessons, eq(lessons.moduleId, modules.id))
    .where(published)
    .groupBy(courses.id)
    .orderBy(desc(courses.createdAt), desc(courses.id))
    .limit(FEATURED_COURSE_LIMIT)
    .all();
}

// Every figure counts published courses only, so the strip never advertises
// a draft or an archived course.
function readStats(db: Db): LandingStats {
  // An aggregate with no GROUP BY always returns exactly one row.
  const [stats] = db
    .select({
      courses: countDistinct(courses.id),
      lessons: countDistinct(lessons.id),
      instructors: countDistinct(courses.instructorId),
      categories: countDistinct(courses.categoryId),
    })
    .from(courses)
    .leftJoin(modules, eq(modules.courseId, courses.id))
    .leftJoin(lessons, eq(lessons.moduleId, modules.id))
    .where(published)
    .all();
  return stats;
}

export function readLandingPage(db: Db): LandingPage {
  return { featuredCourses: readFeaturedCourses(db), stats: readStats(db) };
}

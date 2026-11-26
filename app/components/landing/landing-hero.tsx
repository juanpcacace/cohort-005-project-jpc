import { Link } from "react-router";
import { ArrowRight, BookOpen, CheckCircle2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { CourseImage } from "~/components/course-image";
import type {
  FeaturedCourse,
  LandingStats,
} from "~/modules/landing/index.server";

const HIGHLIGHTS = [
  "Structured modules, one lesson at a time",
  "Quizzes that check what you learned",
  "Progress saved, so you pick up where you left off",
];

export function LandingHero({
  signedIn,
  stats,
  featuredCourses,
}: {
  signedIn: boolean;
  stats: LandingStats;
  featuredCourses: FeaturedCourse[];
}) {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,var(--color-primary)/0.08,transparent_60%)]"
      />
      <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 py-16 sm:py-24 lg:grid-cols-[1.1fr_1fr]">
        <div>
          {stats.courses > 0 && (
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
              <span className="size-1.5 rounded-full bg-primary" />
              {stats.courses} courses · {stats.lessons} lessons
            </p>
          )}
          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">
            Learn to code,
            <br />
            <span className="text-muted-foreground">at your own pace</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">
            Structured courses built by experienced instructors. Track your
            progress, take quizzes, and build real-world skills.
          </p>
          <HeroActions signedIn={signedIn} />
        </div>

        {featuredCourses.length > 0 && (
          <NewCoursesPanel courses={featuredCourses} />
        )}
      </div>
    </section>
  );
}

function NewCoursesPanel({ courses }: { courses: FeaturedCourse[] }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">New on Cadence</p>
        <Link
          to="/courses"
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          See all
        </Link>
      </div>
      <ul className="mt-4 space-y-3">
        {courses.map((course) => (
          <li key={course.id}>
            <Link
              to={`/courses/${course.slug}`}
              className="group flex items-center gap-4 rounded-xl p-2 transition-colors hover:bg-muted"
            >
              <CourseImage
                src={course.coverImageUrl}
                alt=""
                className="h-14 w-20 shrink-0 rounded-lg object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium group-hover:text-primary">
                  {course.title}
                </p>
                <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{course.categoryName}</span>
                  <span aria-hidden>·</span>
                  <span className="flex items-center gap-1">
                    <BookOpen className="size-3" />
                    {course.lessonCount} lessons
                  </span>
                </p>
              </div>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HeroActions({ signedIn }: { signedIn: boolean }) {
  return (
    <>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        {signedIn ? (
          <Button asChild size="lg">
            <Link to="/dashboard">
              Go to your dashboard
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
        ) : (
          <Button asChild size="lg">
            <Link to="/signup">
              Start learning
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
        )}
        <Button asChild size="lg" variant="outline">
          <Link to="/courses">Browse courses</Link>
        </Button>
      </div>
      <ul className="mt-10 space-y-3">
        {HIGHLIGHTS.map((highlight) => (
          <li
            key={highlight}
            className="flex items-center gap-3 text-sm text-muted-foreground"
          >
            <CheckCircle2 className="size-4 shrink-0 text-primary" />
            {highlight}
          </li>
        ))}
      </ul>
    </>
  );
}

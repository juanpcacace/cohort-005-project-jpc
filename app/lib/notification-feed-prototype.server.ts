// PROTOTYPE, throwaway. "What does the Notification Feed look like in Cadence?"
// (juanpcacace/cohort-005-project-jpc#56). Lives on prototype/notification-feed only.
import Knock, { signUserToken } from "@knocklabs/node";
import { eq, ne } from "drizzle-orm";
import { db } from "~/db";
import { courses, lessons, modules, users, UserRole } from "~/db/schema";

if (!process.env.KNOCK_SECRET_API_KEY) {
  // Vite doesn't put non-VITE_ vars on process.env, so load .env ourselves.
  process.loadEnvFile(".env");
}

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`PROTOTYPE: ${name} missing from .env`);
  return value;
}

export const knock = new Knock({ apiKey: env("KNOCK_SECRET_API_KEY") });

export async function getFeedConfig(cadenceUserId: number) {
  return {
    publicApiKey: env("KNOCK_PUBLIC_API_KEY"),
    feedChannelId: env("KNOCK_FEED_CHANNEL_ID"),
    knockUserId: String(cadenceUserId),
    userToken: await signUserToken(String(cadenceUserId), {
      signingKey: env("KNOCK_SIGNING_KEY"),
      expiresInSeconds: 60 * 60,
    }),
  };
}

// Every catalogue entry rides the committed `discussion-reply` workflow, with
// `data.kind` saying which Notification it really is. The UI renders from
// `data`, never from the workflow's template, so only the look is being judged.
export type FeedKind =
  | "refund-approved"
  | "refund-declined"
  | "open-refund-request"
  | "seat-claimed"
  | "new-enrollment"
  | "discussion-question"
  | "discussion-reply";

type Sample = { kind: FeedKind; actorId: number; data: Record<string, unknown> };

function samplesFor(me: { id: number; role: UserRole }, isTeamAdmin: boolean) {
  const course = db.select().from(courses).where(eq(courses.id, 1)).get()!;
  const course2 = db.select().from(courses).where(eq(courses.id, 3)).get()!;
  const lesson = db
    .select({ id: lessons.id, title: lessons.title })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .where(eq(modules.courseId, course.id))
    .limit(1)
    .get()!;
  const others = db.select().from(users).where(ne(users.id, me.id)).all();
  const student = others.find((u) => u.role === UserRole.Student)!;
  const student2 = others.filter((u) => u.role === UserRole.Student)[1]!;
  const instructor = others.find((u) => u.role === UserRole.Instructor)!;
  const lessonUrl = `/courses/${course.slug}/lessons/${lesson.id}`;

  const reply: Sample = {
    kind: "discussion-reply",
    actorId: instructor.id,
    data: {
      actorName: instructor.name,
      lessonTitle: lesson.title,
      snippet: "Good question! The compiler only narrows inside the if-block, so…",
      url: lessonUrl,
    },
  };
  const question = (from: typeof student, snippet: string): Sample => ({
    kind: "discussion-question",
    actorId: from.id,
    data: { actorName: from.name, lessonTitle: lesson.title, snippet, url: lessonUrl },
  });

  if (me.role === UserRole.Admin) {
    return [
      {
        kind: "open-refund-request",
        actorId: student.id,
        data: {
          actorName: student.name,
          courseTitle: course.title,
          amount: "$49.00",
          reason: "Bought the wrong course by mistake",
          url: "/admin/refunds",
        },
      },
      {
        kind: "open-refund-request",
        actorId: student2.id,
        data: {
          actorName: student2.name,
          courseTitle: course2.title,
          amount: "$79.00",
          reason: "The pace is too fast for me",
          url: "/admin/refunds",
        },
      },
      question(student, "Is there a way to run the exercises without installing Node?"),
      reply,
    ] satisfies Sample[];
  }
  if (me.role === UserRole.Instructor) {
    return [
      {
        kind: "new-enrollment",
        actorId: student.id,
        data: { actorName: student.name, courseTitle: course.title, url: `/instructor/${course.id}/students` },
      },
      question(student, "Why does `strict` mode flag this line but the docs example doesn't?"),
      question(student2, "Could you share the starter repo for this lesson?"),
      {
        kind: "new-enrollment",
        actorId: student2.id,
        data: { actorName: student2.name, courseTitle: course2.title, url: `/instructor/${course2.id}/students` },
      },
    ] satisfies Sample[];
  }
  return [
    ...(isTeamAdmin
      ? ([
          {
            kind: "seat-claimed",
            actorId: student.id,
            data: { actorName: student.name, courseTitle: course.title, seatsLeft: 3, url: "/team" },
          },
          {
            kind: "seat-claimed",
            actorId: student2.id,
            data: { actorName: student2.name, courseTitle: course.title, seatsLeft: 2, url: "/team" },
          },
        ] satisfies Sample[])
      : []),
    {
      kind: "refund-approved",
      actorId: 1,
      data: {
        actorName: "Cadence",
        courseTitle: course2.title,
        note: "Refunded in full. Sorry it wasn't the right fit!",
        url: `/courses/${course2.slug}`,
      },
    },
    reply,
    {
      kind: "refund-declined",
      actorId: 1,
      data: {
        actorName: "Cadence",
        courseTitle: course.title,
        note: "You've completed most of the course, which is past our refund window.",
        url: `/courses/${course.slug}`,
      },
    },
  ] satisfies Sample[];
}

// Triggers the samples for `me` one at a time (or just `only` of them), each
// from a different actor, so the feed looks like real traffic.
export async function seedFeed(meId: number, isTeamAdmin: boolean, only?: number) {
  const me = db.select().from(users).where(eq(users.id, meId)).get()!;
  const all = samplesFor(me, isTeamAdmin);
  const picked = only === undefined ? all : [all[only % all.length]!];
  for (const s of picked) {
    const actor = db.select().from(users).where(eq(users.id, s.actorId)).get()!;
    await knock.workflows.trigger("discussion-reply", {
      recipients: [{ id: String(me.id), name: me.name, email: me.email }],
      actor: { id: String(actor.id), name: actor.name, email: actor.email },
      data: { kind: s.kind, ...s.data },
    });
  }
  return picked.length;
}

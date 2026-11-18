import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import {
  saveNotificationPreference,
  visibleNotificationTopics,
} from "./notification-settings.server";
import { fakeProvider, type FakeProvider } from "./notifications.server";
import { readNotificationPreferences } from "./notification-users.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let notifications: FakeProvider;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  notifications = fakeProvider();
});

function buy(userId: number) {
  return db
    .insert(schema.purchases)
    .values({ userId, courseId: base.course.id, amountPaid: 4900 })
    .returning()
    .get();
}

function buyTeamLicence(userId: number) {
  const purchase = buy(userId);
  const team = db.insert(schema.teams).values({}).returning().get();
  db.insert(schema.coupons)
    .values({
      teamId: team.id,
      courseId: base.course.id,
      code: `SEAT-${purchase.id}`,
      purchaseId: purchase.id,
    })
    .run();
}

describe("visibleNotificationTopics", () => {
  it("shows a Student with no Purchases only Discussion Replies", () => {
    expect(visibleNotificationTopics(db, base.user.id)).toEqual([
      "discussion-replies",
    ]);
  });

  it("shows Refund Request updates once the person has a Purchase", () => {
    buy(base.user.id);

    expect(visibleNotificationTopics(db, base.user.id)).toEqual([
      "refund-request-updates",
      "discussion-replies",
    ]);
  });

  it("shows Seat claims to a Team Admin, who has a Team Licence", () => {
    buyTeamLicence(base.user.id);

    expect(visibleNotificationTopics(db, base.user.id)).toEqual([
      "refund-request-updates",
      "seat-claims",
      "discussion-replies",
    ]);
  });

  it("shows an Instructor Enrollments and Discussion Questions", () => {
    expect(visibleNotificationTopics(db, base.instructor.id)).toEqual([
      "enrollments",
      "discussion-questions",
      "discussion-replies",
    ]);
  });

  it("shows a Platform Admin Open Refund Requests", () => {
    const admin = db
      .insert(schema.users)
      .values({ name: "Pat", email: "pat@example.com", role: UserRole.Admin })
      .returning()
      .get();

    expect(visibleNotificationTopics(db, admin.id)).toEqual([
      "open-refund-requests",
      "discussion-replies",
    ]);
  });
});

describe("saveNotificationPreference", () => {
  it("merges the one Topic into the person's Notification Preferences, leaving the rest", async () => {
    await notifications.setPreferences(base.instructor.id, {
      "discussion-questions": { feed: false },
    });

    const result = await saveNotificationPreference(
      db,
      notifications,
      base.instructor.id,
      { topic: "enrollments", enabled: true }
    );

    expect(result).toEqual({ ok: true });
    const preferences = await readNotificationPreferences(
      notifications,
      base.instructor.id
    );
    expect(preferences.enrollments).toEqual({ feed: true });
    expect(preferences["discussion-questions"]).toEqual({ feed: false });
    expect(preferences["discussion-replies"]).toEqual({ feed: true });
  });

  it("refuses input the schema doesn't accept, saving nothing", async () => {
    const result = await saveNotificationPreference(db, notifications, base.user.id, {
      topic: "discussion-replies",
      enabled: "yes",
    });

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(await notifications.readPreferences(base.user.id)).toBeNull();
  });

  it("refuses a Topic whose switch is hidden, so it keeps its default", async () => {
    const result = await saveNotificationPreference(db, notifications, base.user.id, {
      topic: "open-refund-requests",
      enabled: false,
    });

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(await notifications.readPreferences(base.user.id)).toBeNull();
  });

  it("throws when the provider fails, so the card can revert the switch", async () => {
    const failing = {
      ...notifications,
      async setPreferences() {
        throw new Error("Knock is down");
      },
    };

    await expect(
      saveNotificationPreference(db, failing, base.user.id, {
        topic: "discussion-replies",
        enabled: false,
      })
    ).rejects.toThrow("Knock is down");
  });

  it("stops new Notifications for a muted Topic", async () => {
    await saveNotificationPreference(db, notifications, base.user.id, {
      topic: "discussion-replies",
      enabled: false,
    });

    await notifications.send({
      kind: "discussion-reply",
      recipients: [
        { id: base.user.id, name: "Test User", email: "test@example.com", avatarUrl: null },
      ],
      actor: null,
      data: {
        commentId: 2,
        questionId: 1,
        lessonId: 1,
        lessonTitle: "Intro",
        courseSlug: "test-course",
        snippet: "Try this",
      },
      idempotencyKey: "discussion-reply:2",
      cause: { commentId: 2 },
    });

    const feed = await notifications.readFeed(base.user.id, null, 10);
    expect(feed.notifications).toEqual([]);
  });
});

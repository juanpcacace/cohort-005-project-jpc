import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { enrollStudent, toNotificationPerson } from "./enrollments.server";
import { approveRefundRequest, raiseRefundRequest } from "./refunds.server";
import { fakeProvider, noopProvider, readFeedRows } from "./notifications.server";
import { setNotificationPreference, syncNotificationUser } from "./notification-users.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

describe("enrollStudent", () => {
  it("enrolls a Student after an Individual Purchase", async () => {
    db.insert(schema.purchases)
      .values({ userId: base.user.id, courseId: base.course.id, amountPaid: 7900 })
      .run();

    const enrollment = await enrollStudent(db, noopProvider(() => {}), base.user.id, base.course.id, NOW);

    expect(enrollment).toMatchObject({
      userId: base.user.id,
      courseId: base.course.id,
      enrolledAt: NOW.toISOString(),
      completedAt: null,
    });
  });

  it("refuses a second Enrollment on the same course", async () => {
    await enrollStudent(db, noopProvider(() => {}), base.user.id, base.course.id, NOW);

    await expect(
      enrollStudent(db, noopProvider(() => {}), base.user.id, base.course.id, NOW)
    ).rejects.toThrow("User is already enrolled in this course");
  });

  it("enrolls a Lapsed Student again", async () => {
    const admin = db
      .insert(schema.users)
      .values({ name: "Pat", email: "pat@example.com", role: UserRole.Admin })
      .returning()
      .get();
    const purchase = db
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 7900,
        createdAt: new Date(2026, 9, 3).toISOString(),
      })
      .returning()
      .get();
    await enrollStudent(db, noopProvider(() => {}), base.user.id, base.course.id, new Date(2026, 9, 3));
    const raised = await raiseRefundRequest(db, noopProvider(() => {}), purchase.id, base.user.id, "Not for me", NOW);
    if (!raised.ok) throw new Error("expected the Refund Request to be raised");
    await approveRefundRequest(db, noopProvider(() => {}), raised.refundRequestId, admin.id, null, NOW);

    const later = new Date(2026, 9, 20);
    const enrollment = await enrollStudent(db, noopProvider(() => {}), base.user.id, base.course.id, later);

    expect(enrollment).toMatchObject({
      userId: base.user.id,
      courseId: base.course.id,
      enrolledAt: later.toISOString(),
    });
  });
});

describe("Enrollment Notifications", () => {
  it("tells the course's Instructor about a new Enrollment", async () => {
    const notifications = fakeProvider();

    const enrollment = await enrollStudent(db, notifications, base.user.id, base.course.id, NOW);

    expect(notifications.sent).toEqual([
      {
        kind: "enrollment",
        recipients: [
          expect.objectContaining({ id: base.instructor.id, name: base.instructor.name }),
        ],
        actor: expect.objectContaining({ id: base.user.id, name: base.user.name }),
        data: { courseId: base.course.id, courseTitle: base.course.title },
        idempotencyKey: `enrollment:${enrollment.id}`,
        cause: null,
      },
    ]);
  });

  it("puts nothing in the Instructor's Feed under the default Notification Preferences", async () => {
    const notifications = fakeProvider();
    await syncNotificationUser(notifications, toNotificationPerson(base.instructor));

    await enrollStudent(db, notifications, base.user.id, base.course.id, NOW);

    expect(await notifications.readCounts(base.instructor.id)).toEqual({ unseen: 0, unread: 0 });
  });

  it("puts the Enrollment in the Instructor's Feed once they opt in", async () => {
    const notifications = fakeProvider(() => NOW);
    await syncNotificationUser(notifications, toNotificationPerson(base.instructor));
    await setNotificationPreference(notifications, base.instructor.id, "enrollments", true);

    await enrollStudent(db, notifications, base.user.id, base.course.id, NOW);

    const page = await readFeedRows(notifications, base.instructor.id, null, 20);
    expect(page.rows).toEqual([
      expect.objectContaining({
        kind: "enrollment",
        topic: "enrollments",
        title: "Test User enrolled in Test Course",
        link: `/instructor/${base.course.id}/students`,
      }),
    ]);
  });

  it("tells the Instructor again when a Lapsed Student enrolls again", async () => {
    const admin = db
      .insert(schema.users)
      .values({ name: "Pat", email: "pat@example.com", role: UserRole.Admin })
      .returning()
      .get();
    const purchase = db
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 7900,
        createdAt: new Date(2026, 9, 3).toISOString(),
      })
      .returning()
      .get();
    const notifications = fakeProvider();
    const first = await enrollStudent(db, notifications, base.user.id, base.course.id, new Date(2026, 9, 3));
    const raised = await raiseRefundRequest(db, noopProvider(() => {}), purchase.id, base.user.id, "Not for me", NOW);
    if (!raised.ok) throw new Error("expected the Refund Request to be raised");
    await approveRefundRequest(db, noopProvider(() => {}), raised.refundRequestId, admin.id, null, NOW);

    const again = await enrollStudent(db, notifications, base.user.id, base.course.id, new Date(2026, 9, 20));

    expect(notifications.sent.map((n) => [n.kind, n.recipients[0].id, n.idempotencyKey])).toEqual([
      ["enrollment", base.instructor.id, `enrollment:${first.id}`],
      ["enrollment", base.instructor.id, `enrollment:${again.id}`],
    ]);
  });

  it("sends nothing when the Instructor enrolls in their own course", async () => {
    const notifications = fakeProvider();

    await enrollStudent(db, notifications, base.instructor.id, base.course.id, NOW);

    expect(notifications.sent).toEqual([]);
  });

  it("still enrolls the Student when the provider fails", async () => {
    const notifications = {
      ...noopProvider(() => {}),
      send: async () => {
        throw new Error("Knock is down");
      },
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const enrollment = await enrollStudent(db, notifications, base.user.id, base.course.id, NOW);

    expect(enrollment).toMatchObject({ userId: base.user.id, courseId: base.course.id });
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});

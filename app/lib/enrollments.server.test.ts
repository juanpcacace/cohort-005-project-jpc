import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { enrollStudent } from "./enrollments.server";
import { approveRefundRequest, raiseRefundRequest } from "./refunds.server";
import { noopProvider } from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

describe("enrollStudent", () => {
  it("enrolls a Student after an Individual Purchase", () => {
    db.insert(schema.purchases)
      .values({ userId: base.user.id, courseId: base.course.id, amountPaid: 7900 })
      .run();

    const enrollment = enrollStudent(db, base.user.id, base.course.id, NOW);

    expect(enrollment).toMatchObject({
      userId: base.user.id,
      courseId: base.course.id,
      enrolledAt: NOW.toISOString(),
      completedAt: null,
    });
  });

  it("refuses a second Enrollment on the same course", () => {
    enrollStudent(db, base.user.id, base.course.id, NOW);

    expect(() =>
      enrollStudent(db, base.user.id, base.course.id, NOW)
    ).toThrow("User is already enrolled in this course");
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
    enrollStudent(db, base.user.id, base.course.id, new Date(2026, 9, 3));
    const raised = await raiseRefundRequest(db, noopProvider(() => {}), purchase.id, base.user.id, "Not for me", NOW);
    if (!raised.ok) throw new Error("expected the Refund Request to be raised");
    await approveRefundRequest(db, noopProvider(() => {}), raised.refundRequestId, admin.id, null, NOW);

    const later = new Date(2026, 9, 20);
    const enrollment = enrollStudent(db, base.user.id, base.course.id, later);

    expect(enrollment).toMatchObject({
      userId: base.user.id,
      courseId: base.course.id,
      enrolledAt: later.toISOString(),
    });
  });
});

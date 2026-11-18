import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import { completePurchase } from "./purchases.server";
import { fakeProvider } from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

describe("completePurchase", () => {
  it("enrolls the buyer of an Individual Purchase and tells the Instructor", async () => {
    const notifications = fakeProvider();

    const result = await completePurchase(
      db, notifications, base.user.id, base.course.id, 7900, "US", null, NOW
    );

    expect(result.enrollment).toMatchObject({
      userId: base.user.id,
      courseId: base.course.id,
    });
    expect(result.seats).toEqual([]);
    expect(notifications.sent).toEqual([
      expect.objectContaining({
        kind: "enrollment",
        recipients: [expect.objectContaining({ id: base.instructor.id })],
        actor: expect.objectContaining({ id: base.user.id }),
      }),
    ]);
  });

  it("buying a Team Licence creates its Seats, enrolls nobody and sends no Enrollment Notification", async () => {
    const notifications = fakeProvider();

    const result = await completePurchase(
      db, notifications, base.user.id, base.course.id, 3 * 7900, "US", 3, NOW
    );

    expect(result.enrollment).toBeNull();
    expect(result.seats).toHaveLength(3);
    expect(result.seats.every((seat) => seat.redeemedByUserId === null)).toBe(true);
    expect(notifications.sent).toEqual([]);
  });
});

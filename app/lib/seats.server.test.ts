import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { claimSeat } from "./seats.server";
import { fakeProvider, noopProvider, readFeedRows } from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let teamAdmin: typeof schema.users.$inferSelect;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  teamAdmin = addStudent("Tess");
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

function buyTeamLicence(seats: number, country: string | null = null) {
  const team = db.insert(schema.teams).values({}).returning().get();
  const purchase = db
    .insert(schema.purchases)
    .values({
      userId: teamAdmin.id,
      courseId: base.course.id,
      amountPaid: 7900 * seats,
      country,
    })
    .returning()
    .get();
  return Array.from({ length: seats }, (_, i) =>
    db
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: `SEAT-${purchase.id}-${i}`,
        purchaseId: purchase.id,
      })
      .returning()
      .get()
  );
}

describe("claimSeat", () => {
  it("claims an Unclaimed Seat and enrolls the Student", async () => {
    const [seat] = buyTeamLicence(2);

    const result = await claimSeat(db, noopProvider(() => {}), seat.code, base.user.id, "", NOW);

    expect(result).toMatchObject({
      ok: true,
      enrollment: {
        userId: base.user.id,
        courseId: base.course.id,
        enrolledAt: NOW.toISOString(),
      },
    });
  });

  it("refuses a Seat that is already claimed when none are left", async () => {
    const [onlySeat] = buyTeamLicence(1);
    await claimSeat(db, noopProvider(() => {}), onlySeat.code, base.user.id, "", NOW);
    const latecomer = addStudent("Lee");

    const result = await claimSeat(db, noopProvider(() => {}), onlySeat.code, latecomer.id, "", NOW);

    expect(result).toEqual({
      ok: false,
      error: "Coupon has already been redeemed",
    });
  });

  it("refuses an unknown code", async () => {
    expect(await claimSeat(db, noopProvider(() => {}), "NOPE", base.user.id, "", NOW)).toEqual({
      ok: false,
      error: "Coupon not found",
    });
  });

  it("refuses a Student who already has an Enrollment", async () => {
    const [first, second] = buyTeamLicence(2);
    await claimSeat(db, noopProvider(() => {}), first.code, base.user.id, "", NOW);

    expect(await claimSeat(db, noopProvider(() => {}), second.code, base.user.id, "", NOW)).toEqual({
      ok: false,
      error: "You are already enrolled in this course",
    });
  });

  it("refuses a claim from a different country than the Team Licence", async () => {
    const [seat] = buyTeamLicence(1, "IN");

    expect(await claimSeat(db, noopProvider(() => {}), seat.code, base.user.id, "US", NOW)).toEqual({
      ok: false,
      error:
        "This coupon can only be redeemed from the same country as the purchaser",
    });
  });
});

describe("Seat claim Notifications", () => {
  it("tells the Team Admin who claimed a Seat and how many are left", async () => {
    const [seat] = buyTeamLicence(3);
    const notifications = fakeProvider(() => NOW);

    await claimSeat(db, notifications, seat.code, base.user.id, "", NOW);

    const seatClaims = notifications.sent.filter((n) => n.kind === "seat-claimed");
    expect(seatClaims).toEqual([
      {
        kind: "seat-claimed",
        recipients: [expect.objectContaining({ id: teamAdmin.id, name: "Tess" })],
        actor: expect.objectContaining({ id: base.user.id, name: base.user.name }),
        data: {
          seatId: seat.id,
          purchaseId: seat.purchaseId,
          courseTitle: base.course.title,
          seatsLeft: 2,
        },
        idempotencyKey: `seat-claimed:${seat.id}`,
        cause: null,
      },
    ]);
    const page = await readFeedRows(notifications, teamAdmin.id, null, 20);
    expect(page.rows).toEqual([
      expect.objectContaining({
        kind: "seat-claimed",
        topic: "seat-claims",
        title: "Test User claimed a Seat on Test Course",
        snippet: "2 Seats left.",
        link: "/team",
      }),
    ]);
  });

  it("sends one Notification per claim and counts down to no Seats left", async () => {
    const [first, second] = buyTeamLicence(2);
    const notifications = fakeProvider();

    await claimSeat(db, notifications, first.code, base.user.id, "", NOW);
    await claimSeat(db, notifications, second.code, addStudent("Lee").id, "", NOW);

    const seatsLeft = notifications.sent.flatMap((n) =>
      n.kind === "seat-claimed" ? [n.data.seatsLeft] : []
    );
    expect(seatsLeft).toEqual([1, 0]);
  });

  it("tells the course's Instructor about the Enrollment a Claimed Seat gives", async () => {
    const [seat] = buyTeamLicence(1);
    const notifications = fakeProvider();

    await claimSeat(db, notifications, seat.code, base.user.id, "", NOW);

    const enrollments = notifications.sent.filter((n) => n.kind === "enrollment");
    expect(enrollments).toEqual([
      expect.objectContaining({
        recipients: [expect.objectContaining({ id: base.instructor.id })],
        actor: expect.objectContaining({ id: base.user.id }),
      }),
    ]);
  });

  it("sends nothing for a refused claim", async () => {
    const [seat] = buyTeamLicence(1, "IN");
    const notifications = fakeProvider();

    await claimSeat(db, notifications, seat.code, base.user.id, "US", NOW);

    expect(notifications.sent).toEqual([]);
  });

  it("still claims the Seat when the provider fails", async () => {
    const [seat] = buyTeamLicence(1);
    const notifications = {
      ...noopProvider(() => {}),
      send: async () => {
        throw new Error("Knock is down");
      },
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await claimSeat(db, notifications, seat.code, base.user.id, "", NOW);

    expect(result).toMatchObject({ ok: true, enrollment: { userId: base.user.id } });
    errors.mockRestore();
  });
});

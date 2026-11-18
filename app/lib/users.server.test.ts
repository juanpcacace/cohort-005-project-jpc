import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import {
  fakeProvider,
  type FakeProvider,
  type NotificationsProvider,
} from "./notifications.server";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "./notification-preferences";
import { readNotificationPreferences } from "./notification-users.server";
import {
  signUpStudent,
  syncAllNotificationUsers,
  updateProfile,
  updateUserDetails,
} from "./users.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let notifications: FakeProvider;

beforeEach(() => {
  notifications = fakeProvider();
  db = createTestDb();
  base = seedBaseData(db);
});

function throwingProvider(): NotificationsProvider {
  const fail = async () => {
    throw new Error("Knock is down");
  };
  return {
    ...fakeProvider(),
    identifyUser: fail,
    readPreferences: fail,
    setPreferences: fail,
  };
}

describe("signUpStudent", () => {
  it("creates a Student and syncs them with the default Notification Preferences", async () => {
    const user = await signUpStudent(db, notifications, "Grace", "grace@example.com");

    expect(user).toMatchObject({ name: "Grace", role: UserRole.Student });
    expect(notifications.identified.get(user.id)).toEqual({
      id: user.id,
      name: "Grace",
      email: "grace@example.com",
      avatarUrl: null,
    });
    expect(await notifications.readPreferences(user.id)).toEqual(
      DEFAULT_NOTIFICATION_PREFERENCES
    );
  });

  it("still signs the person up when the provider throws", async () => {
    const user = await signUpStudent(db, throwingProvider(), "Grace", "grace@example.com");

    expect(user.id).toBeGreaterThan(0);
  });
});

describe("updateProfile", () => {
  it("saves the name and bio and syncs the new name", async () => {
    await updateProfile(db, notifications, base.user.id, "Renamed", "Hello");

    expect(notifications.identified.get(base.user.id)).toMatchObject({
      name: "Renamed",
      email: "test@example.com",
    });
    expect(
      db.query.users.findFirst({ where: (u) => eq(u.id, base.user.id) }).sync()
    ).toMatchObject({ name: "Renamed", bio: "Hello" });
  });

  it("keeps changed Notification Preferences", async () => {
    await notifications.setPreferences(base.user.id, {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      "discussion-replies": { feed: false },
    });

    await updateProfile(db, notifications, base.user.id, "Renamed", null);

    expect(
      (await readNotificationPreferences(notifications, base.user.id))["discussion-replies"]
    ).toEqual({ feed: false });
  });

  it("still saves when the provider throws", async () => {
    await updateProfile(db, throwingProvider(), base.user.id, "Renamed", null);

    expect(
      db.query.users.findFirst({ where: (u) => eq(u.id, base.user.id) }).sync()
    ).toMatchObject({ name: "Renamed" });
  });
});

describe("updateUserDetails (Platform Admin edit)", () => {
  it("saves the name and email and syncs them", async () => {
    await updateUserDetails(db, notifications, base.user.id, "New Name", "new@example.com");

    expect(notifications.identified.get(base.user.id)).toMatchObject({
      name: "New Name",
      email: "new@example.com",
    });
  });

  it("still saves when the provider throws", async () => {
    await updateUserDetails(db, throwingProvider(), base.user.id, "New Name", "new@example.com");

    expect(
      db.query.users.findFirst({ where: (u) => eq(u.id, base.user.id) }).sync()
    ).toMatchObject({ name: "New Name", email: "new@example.com" });
  });
});

describe("syncAllNotificationUsers (seed and backfill)", () => {
  it("syncs every user, avatar included", async () => {
    db.update(schema.users)
      .set({ avatarUrl: "https://example.com/i.png" })
      .where(eq(schema.users.id, base.instructor.id))
      .run();

    const count = await syncAllNotificationUsers(db, notifications);

    expect(count).toBe(2);
    expect([...notifications.identified.keys()].sort()).toEqual(
      [base.user.id, base.instructor.id].sort()
    );
    expect(notifications.identified.get(base.instructor.id)?.avatarUrl).toBe(
      "https://example.com/i.png"
    );
    expect(await notifications.readPreferences(base.user.id)).toEqual(
      DEFAULT_NOTIFICATION_PREFERENCES
    );
  });
});

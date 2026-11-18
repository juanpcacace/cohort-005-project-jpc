import { describe, it, expect, beforeEach } from "vitest";
import { fakeProvider, type FakeProvider } from "./notifications.server";
import {
  readNotificationPreferences,
  setNotificationPreference,
  syncNotificationUser,
} from "./notification-users.server";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "./notification-preferences";

const ADA = {
  id: 7,
  name: "Ada",
  email: "ada@example.com",
  avatarUrl: "https://example.com/ada.png",
};

let notifications: FakeProvider;

beforeEach(() => {
  notifications = fakeProvider();
});

describe("syncNotificationUser", () => {
  it("identifies the user and writes the defaults: every Topic on but Enrollments, on the Feed", async () => {
    await syncNotificationUser(notifications, ADA);

    expect(notifications.identified.get(7)).toEqual(ADA);
    expect(await notifications.readPreferences(7)).toEqual({
      "refund-request-updates": { feed: true },
      "open-refund-requests": { feed: true },
      "seat-claims": { feed: true },
      enrollments: { feed: false },
      "discussion-questions": { feed: true },
      "discussion-replies": { feed: true },
    });
  });

  it("never overwrites Notification Preferences on a later sync, but updates name and avatar", async () => {
    await syncNotificationUser(notifications, ADA);
    await setNotificationPreference(notifications, 7, "enrollments", true);
    await setNotificationPreference(notifications, 7, "seat-claims", false);

    await syncNotificationUser(notifications, { ...ADA, name: "Ada L.", avatarUrl: null });

    expect(notifications.identified.get(7)).toMatchObject({ name: "Ada L.", avatarUrl: null });
    const preferences = await readNotificationPreferences(notifications, 7);
    expect(preferences.enrollments).toEqual({ feed: true });
    expect(preferences["seat-claims"]).toEqual({ feed: false });
  });

  it("logs and doesn't throw when the provider fails", async () => {
    const failing = {
      ...notifications,
      async identifyUser() {
        throw new Error("Knock is down");
      },
    };

    await expect(syncNotificationUser(failing, ADA)).resolves.toBeUndefined();
  });
});

describe("setNotificationPreference", () => {
  it("changes one Topic and leaves every other Topic unchanged", async () => {
    await syncNotificationUser(notifications, ADA);
    await setNotificationPreference(notifications, 7, "discussion-replies", false);

    expect(await readNotificationPreferences(notifications, 7)).toEqual({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      "discussion-replies": { feed: false },
    });
  });

  it("stores the defaults alongside the change for a user never synced, so Enrollments stays off", async () => {
    await setNotificationPreference(notifications, 99, "seat-claims", false);

    expect(await notifications.readPreferences(99)).toEqual({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      "seat-claims": { feed: false },
    });
  });

  it("throws when the provider fails, so the settings card can revert the switch", async () => {
    const failing = {
      ...notifications,
      async setPreferences() {
        throw new Error("Knock is down");
      },
    };

    await expect(
      setNotificationPreference(failing, 7, "enrollments", true)
    ).rejects.toThrow("Knock is down");
  });
});

describe("a muted Topic (fake provider)", () => {
  it("leaves its Notifications out of the person's Feed entirely", async () => {
    await syncNotificationUser(notifications, ADA);
    await setNotificationPreference(notifications, 7, "discussion-replies", false);

    await notifications.send({
      kind: "discussion-reply",
      recipients: [ADA],
      actor: null,
      data: {
        commentId: 2,
        questionId: 1,
        lessonId: 1,
        lessonTitle: "Closures",
        courseSlug: "js",
        snippet: "Hi",
      },
      idempotencyKey: "discussion-reply:2",
      cause: { commentId: 2 },
    });

    expect(await notifications.readCounts(7)).toEqual({ unseen: 0, unread: 0 });
  });
});

describe("readNotificationPreferences", () => {
  it("reads the defaults for a user never synced", async () => {
    expect(await readNotificationPreferences(notifications, 99)).toEqual(
      DEFAULT_NOTIFICATION_PREFERENCES
    );
  });
});

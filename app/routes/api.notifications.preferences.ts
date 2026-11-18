import { data } from "react-router";
import { db } from "~/db";
import { requireUserId } from "~/lib/access.server";
import { saveNotificationPreference } from "~/lib/notification-settings.server";
import { defaultNotificationsProvider } from "~/lib/notifications.server";
import type { Route } from "./+types/api.notifications.preferences";

// Turns one of the signed-in user's Notification Topics on or off. A provider
// failure throws (500), so the settings card reverts the switch.
export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const result = await saveNotificationPreference(
    db,
    defaultNotificationsProvider(),
    userId,
    await request.json().catch(() => null)
  );
  if (!result.ok) {
    throw data(result.error, { status: result.status });
  }
  return { ok: true };
}

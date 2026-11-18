import { requireUserId } from "~/lib/access.server";
import { defaultNotificationsProvider } from "~/lib/notifications.server";
import type { Route } from "./+types/api.notifications.read-all";

// "Mark all as read": every one of the signed-in user's Notifications,
// including ones the popover hasn't loaded.
export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  await defaultNotificationsProvider().markAllRead(userId);
  return { ok: true };
}

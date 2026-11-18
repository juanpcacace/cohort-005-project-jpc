import { requireUserId } from "~/lib/access.server";
import { defaultNotificationsProvider } from "~/lib/notifications.server";
import type { Route } from "./+types/api.notifications.seen-all";

// Marks every one of the signed-in user's Notifications seen, including ones
// the popover hasn't loaded. The bell calls this when the popover opens.
export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  await defaultNotificationsProvider().markAllSeen(userId);
  return { ok: true };
}

import { requireUserId } from "~/lib/access.server";
import { defaultNotificationsProvider } from "~/lib/notifications.server";
import type { Route } from "./+types/api.notifications.counts";

// The signed-in user's unseen and unread counts. The bell polls this, so it
// stays one provider read.
export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  return defaultNotificationsProvider().readCounts(userId);
}

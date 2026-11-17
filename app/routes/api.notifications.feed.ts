import { requireUserId } from "~/lib/access.server";
import { FEED_PAGE_SIZE } from "~/lib/notifications";
import {
  defaultNotificationsProvider,
  readFeedRows,
} from "~/lib/notifications.server";
import type { Route } from "./+types/api.notifications.feed";

// One page of the signed-in user's Notification Feed, as Cadence rows.
// `?cursor=` reads the next (older) page.
export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const cursor = new URL(request.url).searchParams.get("cursor") || null;
  return readFeedRows(
    defaultNotificationsProvider(),
    userId,
    cursor,
    FEED_PAGE_SIZE
  );
}

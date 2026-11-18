import { z } from "zod";
import { requireUserId } from "~/lib/access.server";
import { FEED_PAGE_SIZE } from "~/lib/notifications";
import {
  defaultNotificationsProvider,
  readFeedRows,
} from "~/lib/notifications.server";
import { parseParams } from "~/lib/validation";
import type { Route } from "./+types/api.notifications.feed";

// An empty or missing cursor reads the first page.
const feedQuerySchema = z.object({
  cursor: z
    .string()
    .optional()
    .transform((cursor) => cursor || null),
});

// One page of the signed-in user's Notification Feed, as Cadence rows.
// `?cursor=` reads the next (older) page.
export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const { cursor } = parseParams(
    Object.fromEntries(new URL(request.url).searchParams),
    feedQuerySchema
  );
  return readFeedRows(
    defaultNotificationsProvider(),
    userId,
    cursor,
    FEED_PAGE_SIZE
  );
}

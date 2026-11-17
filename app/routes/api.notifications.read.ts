import { data } from "react-router";
import { z } from "zod";
import { requireUserId } from "~/lib/access.server";
import { defaultNotificationsProvider } from "~/lib/notifications.server";
import { parseJsonBody } from "~/lib/validation";
import type { Route } from "./+types/api.notifications.read";

const markReadSchema = z.object({ id: z.string().min(1) });

// Marks one of the signed-in user's own Notifications read.
export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const parsed = await parseJsonBody(request, markReadSchema);
  if (!parsed.success) {
    throw data("Invalid parameters", { status: 400 });
  }
  await defaultNotificationsProvider().markRead(userId, parsed.data.id);
  return { ok: true };
}

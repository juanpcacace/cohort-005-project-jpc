// PROTOTYPE, throwaway. "What does the Notification Feed look like in Cadence?"
// (juanpcacace/cohort-005-project-jpc#56). Lives on prototype/notification-feed only.
// The full-page feed for variant B, plus the switcher bar's seed actions.
import type { Route } from "./+types/prototype.notifications";
import { requireUserId } from "~/lib/access.server";
import { seedFeed } from "~/lib/notification-feed-prototype.server";
import { db } from "~/db";
import { teamMembers, TeamMemberRole } from "~/db/schema";
import { and, eq } from "drizzle-orm";
import { PrototypeNote, VariantBInboxPage } from "~/components/notification-feed-prototype";

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const form = await request.formData();
  const isTeamAdmin = !!db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, userId), eq(teamMembers.role, TeamMemberRole.Admin)))
    .get();
  const intent = form.get("intent");
  if (intent === "hundred") {
    // 100 Notifications to exercise pagination, sent 10 at a time.
    for (let batch = 0; batch < 10; batch++) {
      await Promise.all(
        Array.from({ length: 10 }, (_, i) => seedFeed(userId, isTeamAdmin, batch * 10 + i))
      );
    }
    return { triggered: 100 };
  }
  const only = intent === "one" ? Number(form.get("n")) : undefined;
  return { triggered: await seedFeed(userId, isTeamAdmin, only) };
}

export default function NotificationsPrototype() {
  return (
    <>
      <PrototypeNote />
      <VariantBInboxPage />
    </>
  );
}

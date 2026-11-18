import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Switch } from "~/components/ui/switch";
import type { NotificationPreferences } from "~/lib/notification-preferences";
import type { NotificationTopic } from "~/lib/notifications";

// ─── Notifications card on /settings ───
// One switch per Notification Topic the person can receive. Each flip saves at
// once; a failed save shows a toast and puts the switch back.

/** Where the bell's gear links to. */
export const NOTIFICATION_PREFERENCES_ANCHOR = "notifications";

const TOPIC_COPY: Record<NotificationTopic, { label: string; description: string }> = {
  "refund-request-updates": {
    label: "Refund Request updates",
    description: "When we receive or decide a Refund Request you raised.",
  },
  "open-refund-requests": {
    label: "Open Refund Requests",
    description: "When a buyer raises a Refund Request.",
  },
  "seat-claims": {
    label: "Seat claims",
    description: "When a Student claims a Seat on your Team Licence.",
  },
  enrollments: {
    label: "Enrollments",
    description: "When a Student enrolls on one of your courses.",
  },
  "discussion-questions": {
    label: "Discussion Questions",
    description: "When a Student asks a question on one of your lessons.",
  },
  "discussion-replies": {
    label: "Discussion Replies",
    description: "When someone replies to a question you asked.",
  },
};

export function NotificationPreferencesCard({
  topics,
  preferences,
}: {
  topics: NotificationTopic[];
  /** Null when they couldn't be loaded. */
  preferences: NotificationPreferences | null;
}) {
  const [enabled, setEnabled] = useState(() =>
    preferences
      ? Object.fromEntries(topics.map((topic) => [topic, preferences[topic].feed]))
      : null
  );

  async function flip(topic: NotificationTopic, next: boolean) {
    setEnabled((current) => current && { ...current, [topic]: next });
    try {
      const response = await fetch("/api/notifications/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, enabled: next }),
      });
      if (!response.ok) throw new Error(`Status ${response.status}`);
    } catch {
      setEnabled((current) => current && { ...current, [topic]: !next });
      toast.error(`Couldn't save "${TOPIC_COPY[topic].label}". Try again.`);
    }
  }

  return (
    <Card id={NOTIFICATION_PREFERENCES_ANCHOR} className="mt-8 max-w-md scroll-mt-6">
      <CardHeader>
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="text-sm text-muted-foreground">
          Choose what shows up in your Notification Feed.
        </p>
      </CardHeader>
      <CardContent>
        {enabled === null ? (
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t load your Notification Preferences.
          </p>
        ) : (
          <ul className="space-y-4">
            {topics.map((topic) => (
              <li key={topic} className="flex items-start justify-between gap-4">
                <label htmlFor={`topic-${topic}`} className="space-y-0.5">
                  <span className="block text-sm font-medium">
                    {TOPIC_COPY[topic].label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {TOPIC_COPY[topic].description}
                  </span>
                </label>
                <Switch
                  id={`topic-${topic}`}
                  checked={enabled[topic]}
                  onCheckedChange={(next) => flip(topic, next)}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

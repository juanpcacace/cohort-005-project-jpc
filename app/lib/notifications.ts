import { commentAnchor } from "~/lib/comments";
import { formatPrice } from "~/lib/utils";

// ─── Notifications (shared by server and browser) ───
// The Cadence-side vocabulary for Notifications: the kinds, the Notification
// Topic each kind belongs to, the data snapshot each kind carries, and how a
// Notification becomes a row in the Notification Feed. No vendor terms here;
// those stay inside the provider adapter (ADR 0013).

/** How often the bell asks for the unseen count. Well under the vendor's rate limit. */
export const FEED_POLL_INTERVAL_MS = 30_000;

/** How many Notifications one Feed page holds. */
export const FEED_PAGE_SIZE = 20;

/** The longest snippet of comment text a Notification keeps. */
export const SNIPPET_LENGTH = 140;

export type NotificationTopic =
  | "refund-request-updates"
  | "open-refund-requests"
  | "seat-claims"
  | "enrollments"
  | "discussion-questions"
  | "discussion-replies";

/**
 * The data snapshot each kind of Notification carries, taken when it is sent.
 * Add a kind by adding its entry here, its Topic below, and its row copy in
 * `toFeedRow`.
 */
export type NotificationData = {
  "discussion-question": {
    commentId: number;
    lessonId: number;
    lessonTitle: string;
    courseSlug: string;
    snippet: string;
  };
  "discussion-reply": {
    commentId: number;
    questionId: number;
    lessonId: number;
    lessonTitle: string;
    courseSlug: string;
    snippet: string;
  };
  "refund-request-confirmation": {
    refundRequestId: number;
    courseTitle: string;
    /** Cents. */
    amount: number;
  };
  "open-refund-request": {
    refundRequestId: number;
    courseTitle: string;
    /** Cents. */
    amount: number;
    reason: string;
  };
  "refund-request-approved": RefundDecisionData;
  "refund-request-declined": RefundDecisionData;
  "seat-claimed": {
    seatId: number;
    purchaseId: number;
    courseTitle: string;
    /** Unclaimed Seats left on the Team Licence after this claim. */
    seatsLeft: number;
  };
  enrollment: {
    courseId: number;
    courseTitle: string;
  };
};

/** What a Refund Request decision Notification carries. */
type RefundDecisionData = {
  refundRequestId: number;
  purchaseId: number;
  courseTitle: string;
  /** Cents. */
  amount: number;
  note: string | null;
  /** Where the buyer sees their Refund Requests: `/settings`, or `/team` for a Team Licence. */
  refundView: string;
};

export type NotificationKind = keyof NotificationData;

export const NOTIFICATION_TOPICS: Record<NotificationKind, NotificationTopic> = {
  "discussion-question": "discussion-questions",
  "discussion-reply": "discussion-replies",
  "refund-request-confirmation": "refund-request-updates",
  "refund-request-approved": "refund-request-updates",
  "refund-request-declined": "refund-request-updates",
  "open-refund-request": "open-refund-requests",
  "seat-claimed": "seat-claims",
  enrollment: "enrollments",
};

export function isNotificationKind(value: string): value is NotificationKind {
  return Object.hasOwn(NOTIFICATION_TOPICS, value);
}

/** Who caused a Notification, as the Feed shows them. */
export type FeedActor = { name: string; avatarUrl: string | null };

/** A Notification as it sits in someone's Notification Feed. */
export type FeedNotification = {
  [K in NotificationKind]: {
    id: string;
    kind: K;
    /** Null when Cadence itself sent it. */
    actor: FeedActor | null;
    data: NotificationData[K];
    sentAt: string;
    seen: boolean;
    read: boolean;
  };
}[NotificationKind];

export type FeedCounts = { unseen: number; unread: number };

/** A Notification as the browser renders it: Cadence writes the copy. */
export type FeedRow = {
  id: string;
  kind: NotificationKind;
  topic: NotificationTopic;
  actor: FeedActor | null;
  title: string;
  snippet: string;
  /** Null when there is nowhere to go. */
  link: string | null;
  sentAt: string;
  seen: boolean;
  read: boolean;
};

export type FeedRowPage = { rows: FeedRow[]; nextCursor: string | null };

export function toFeedRow(notification: FeedNotification): FeedRow {
  const actorName = notification.actor?.name ?? "Cadence";
  const base = {
    id: notification.id,
    kind: notification.kind,
    topic: NOTIFICATION_TOPICS[notification.kind],
    actor: notification.actor,
    sentAt: notification.sentAt,
    seen: notification.seen,
    read: notification.read,
  };

  switch (notification.kind) {
    case "discussion-question": {
      const { data } = notification;
      return {
        ...base,
        title: `${actorName} asked a question on ${data.lessonTitle}`,
        snippet: data.snippet,
        link: `/courses/${data.courseSlug}/lessons/${data.lessonId}#${commentAnchor(data.commentId)}`,
      };
    }
    case "discussion-reply": {
      const { data } = notification;
      return {
        ...base,
        title: `${actorName} replied to your question`,
        snippet: data.snippet,
        link: `/courses/${data.courseSlug}/lessons/${data.lessonId}#${commentAnchor(data.commentId)}`,
      };
    }
    case "refund-request-confirmation": {
      const { data } = notification;
      return {
        ...base,
        title: "We've received your Refund Request",
        snippet: `${data.courseTitle}, ${formatPrice(data.amount)}. It's under review.`,
        link: null,
      };
    }
    case "open-refund-request": {
      const { data } = notification;
      return {
        ...base,
        title: `${actorName} requested a ${formatPrice(data.amount)} refund`,
        snippet: `${data.courseTitle}: ${data.reason}`,
        link: "/admin/refunds",
      };
    }
    case "refund-request-approved": {
      const { data } = notification;
      return {
        ...base,
        title: `Your Refund Request for ${data.courseTitle} was approved`,
        snippet: sentences(
          `${formatPrice(data.amount)} from Purchase #${data.purchaseId} is on its way back to you.`,
          data.note
        ),
        link: data.refundView,
      };
    }
    case "refund-request-declined": {
      const { data } = notification;
      return {
        ...base,
        title: `Your Refund Request for ${data.courseTitle} was declined`,
        snippet: sentences(
          `Purchase #${data.purchaseId} (${formatPrice(data.amount)}) was not refunded.`,
          data.note,
          "You can ask again."
        ),
        link: data.refundView,
      };
    }
    case "seat-claimed": {
      const { data } = notification;
      return {
        ...base,
        title: `${actorName} claimed a Seat on ${data.courseTitle}`,
        snippet: seatsLeftText(data.seatsLeft),
        link: "/team",
      };
    }
    case "enrollment": {
      const { data } = notification;
      return {
        ...base,
        title: `${actorName} enrolled in ${data.courseTitle}`,
        snippet: "A new Student in your course.",
        link: `/instructor/${data.courseId}/students`,
      };
    }
  }
}

/** Joins the sentences that are there, skipping a missing note. */
function sentences(...parts: (string | null)[]): string {
  return parts.filter((part) => part).join(" ");
}

function seatsLeftText(seatsLeft: number): string {
  if (seatsLeft === 0) return "No Seats left.";
  return `${seatsLeft} ${seatsLeft === 1 ? "Seat" : "Seats"} left.`;
}

/**
 * Plain one-line text from a comment's markdown, cut to `SNIPPET_LENGTH`.
 * Comment bodies are untrusted, so the snippet never carries markup.
 */
export function toSnippet(markdown: string): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= SNIPPET_LENGTH) return text;
  return `${text.slice(0, SNIPPET_LENGTH - 1).trimEnd()}…`;
}

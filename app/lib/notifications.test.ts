import { describe, it, expect } from "vitest";
import { toFeedRow, toSnippet } from "./notifications";

describe("toFeedRow", () => {
  it("writes a Discussion Reply row that links to the reply on its lesson", () => {
    const row = toFeedRow({
      id: "m1",
      kind: "discussion-reply",
      actor: { name: "Ada", avatarUrl: "https://example.com/ada.png" },
      data: {
        commentId: 42,
        questionId: 7,
        lessonId: 3,
        lessonTitle: "Closures",
        courseSlug: "js-basics",
        snippet: "Because scope.",
      },
      sentAt: "2026-10-06T12:00:00.000Z",
      seen: true,
      read: false,
    });

    expect(row).toEqual({
      id: "m1",
      kind: "discussion-reply",
      topic: "discussion-replies",
      actor: { name: "Ada", avatarUrl: "https://example.com/ada.png" },
      title: "Ada replied to your question",
      snippet: "Because scope.",
      link: "/courses/js-basics/lessons/3#comment-42",
      sentAt: "2026-10-06T12:00:00.000Z",
      seen: true,
      read: false,
    });
  });

  it("leaves the sender empty when Cadence itself sent it, and names Cadence", () => {
    const row = toFeedRow({
      id: "m2",
      kind: "discussion-reply",
      actor: null,
      data: {
        commentId: 42,
        questionId: 7,
        lessonId: 3,
        lessonTitle: "Closures",
        courseSlug: "js-basics",
        snippet: "Because scope.",
      },
      sentAt: "2026-10-06T12:00:00.000Z",
      seen: false,
      read: false,
    });

    expect(row.actor).toBeNull();
    expect(row.title).toBe("Cadence replied to your question");
  });
});

describe("toFeedRow for Refund Requests", () => {
  const at = { sentAt: "2026-10-06T12:00:00.000Z", seen: false, read: false };
  const decision = {
    refundRequestId: 5,
    purchaseId: 9,
    courseTitle: "JS Basics",
    amount: 7900,
    refundView: "/settings",
  };

  it("writes the confirmation from Cadence, with nowhere to go", () => {
    const row = toFeedRow({
      id: "m2",
      kind: "refund-request-confirmation",
      actor: null,
      data: { refundRequestId: 5, courseTitle: "JS Basics", amount: 7900 },
      ...at,
    });

    expect(row).toMatchObject({
      topic: "refund-request-updates",
      actor: null,
      title: "We've received your Refund Request",
      snippet: "JS Basics, $79.00. It's under review.",
      link: null,
    });
  });

  it("writes an Open Refund Request with who asked and why, linking to admin refunds", () => {
    const row = toFeedRow({
      id: "m3",
      kind: "open-refund-request",
      actor: { name: "Ada", avatarUrl: null },
      data: { refundRequestId: 5, courseTitle: "JS Basics", amount: 7900, reason: "Too hard." },
      ...at,
    });

    expect(row).toMatchObject({
      topic: "open-refund-requests",
      title: "Ada requested a $79.00 refund",
      snippet: "JS Basics: Too hard.",
      link: "/admin/refunds",
    });
  });

  it("writes an approval naming the course, the Purchase and the decision note, linking to the buyer's refund view", () => {
    const row = toFeedRow({
      id: "m4",
      kind: "refund-request-approved",
      actor: null,
      data: { ...decision, note: "Sorry it didn't fit." },
      ...at,
    });

    expect(row).toMatchObject({
      topic: "refund-request-updates",
      title: "Your Refund Request for JS Basics was approved",
      snippet: "$79.00 from Purchase #9 is on its way back to you. Sorry it didn't fit.",
      link: "/settings",
    });
  });

  it("writes an approval without a note as the Purchase's money on its way", () => {
    const row = toFeedRow({
      id: "m5",
      kind: "refund-request-approved",
      actor: null,
      data: { ...decision, note: null, refundView: "/team" },
      ...at,
    });

    expect(row).toMatchObject({
      snippet: "$79.00 from Purchase #9 is on its way back to you.",
      link: "/team",
    });
  });

  it("writes a decline naming the Purchase, with the note and that they can ask again", () => {
    const row = toFeedRow({
      id: "m6",
      kind: "refund-request-declined",
      actor: null,
      data: { ...decision, note: "Past half way." },
      ...at,
    });

    expect(row).toMatchObject({
      topic: "refund-request-updates",
      title: "Your Refund Request for JS Basics was declined",
      snippet: "Purchase #9 ($79.00) was not refunded. Past half way. You can ask again.",
      link: "/settings",
    });
  });
});

describe("toFeedRow for Seat claims and Enrollments", () => {
  const ada = { name: "Ada", avatarUrl: null };
  const seatClaim = (seatsLeft: number) =>
    toFeedRow({
      id: "m10",
      kind: "seat-claimed",
      actor: ada,
      data: { seatId: 4, purchaseId: 2, courseTitle: "JS Basics", seatsLeft },
      sentAt: "2026-10-06T12:00:00.000Z",
      seen: false,
      read: false,
    });

  it("names who claimed the Seat and links to the team page", () => {
    expect(seatClaim(1)).toMatchObject({
      topic: "seat-claims",
      title: "Ada claimed a Seat on JS Basics",
      snippet: "1 Seat left.",
      link: "/team",
    });
  });

  it("says when no Seats are left", () => {
    expect(seatClaim(0).snippet).toBe("No Seats left.");
  });

  it("links an Enrollment to the Instructor's students page", () => {
    const row = toFeedRow({
      id: "m11",
      kind: "enrollment",
      actor: ada,
      data: { courseId: 9, courseTitle: "JS Basics" },
      sentAt: "2026-10-06T12:00:00.000Z",
      seen: false,
      read: false,
    });

    expect(row).toMatchObject({
      topic: "enrollments",
      title: "Ada enrolled in JS Basics",
      link: "/instructor/9/students",
    });
  });
});

describe("toSnippet", () => {
  it("drops markdown and keeps one line", () => {
    expect(
      toSnippet("**Bold** and `code`\n\n> quoted [link](https://x.dev)")
    ).toBe("Bold and code quoted link");
  });

  it("cuts long text with an ellipsis", () => {
    const snippet = toSnippet("word ".repeat(100));

    expect(snippet.length).toBeLessThanOrEqual(140);
    expect(snippet.endsWith("…")).toBe(true);
  });
});

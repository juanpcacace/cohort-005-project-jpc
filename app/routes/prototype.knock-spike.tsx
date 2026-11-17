// PROTOTYPE — throwaway Knock spike for "Does Knock hold up against Cadence?"
// (issue #47). Branch prototype/knock-spike only. Never merge.
//
// Assumption: the question is vendor fit, not Feed look, so this is a bare
// test bench on a real app route (real session, real DevUI switcher, real
// seed data), not a UI exploration. Each panel is one of the four checks.
import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import Knock, { type Feed, type FeedStoreState } from "@knocklabs/client";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/prototype.knock-spike";
import { requireUserId } from "~/lib/access.server";
import { db } from "~/db";
import { users } from "~/db/schema";
import {
  ENROLLMENT_CATEGORY,
  identify,
  knock,
  knockPublicConfig,
  knockUserId,
  repliesToQuestionsBy,
  signTokenFor,
} from "~/lib/knock-spike.server";

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const user = await identify(userId);
  const userToken = await signTokenFor(userId);
  const preferences = await knock.users
    .getPreferences(knockUserId(userId), "default")
    .catch((e) => ({ error: String(e.message ?? e) }));
  const otherUser = db.select().from(users).all().find((u) => u.id !== userId);
  return {
    user: { id: user.id, name: user.name, role: user.role },
    knockUserId: knockUserId(userId),
    userToken,
    otherKnockUserId: otherUser ? knockUserId(otherUser.id) : null,
    ...knockPublicConfig,
    replies: repliesToQuestionsBy(userId).slice(0, 5),
    preferences,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const me = knockUserId(userId);

  if (intent === "trigger-reply") {
    // Discussion Reply → question author. The current user is the author.
    const reply = repliesToQuestionsBy(userId).find(
      (r) => r.replyId === Number(form.get("replyId"))
    );
    if (!reply) return { intent, error: "Reply not found" };
    await identify(reply.replierId);
    const result = await knock.workflows.trigger("discussion-reply", {
      recipients: [me],
      actor: knockUserId(reply.replierId),
      data: {
        reply_id: reply.replyId,
        lesson_id: reply.lessonId,
        replier_name: reply.replierName,
        question_excerpt: reply.questionBody.slice(0, 80),
        reply_excerpt: reply.replyBody.slice(0, 80),
      },
    });
    return { intent, result };
  }

  if (intent === "trigger-enrollment") {
    // New Enrollment → Instructor. Current user stands in as the Instructor.
    const result = await knock.workflows.trigger("new-enrollment", {
      recipients: [me],
      data: { student_name: "Spike Student", course_title: "Spike Course" },
    });
    return { intent, result };
  }

  if (intent === "opt-in") {
    const result = await knock.users.setPreferences(me, "default", {
      categories: { [ENROLLMENT_CATEGORY]: true },
    });
    return { intent, result };
  }

  if (intent === "reset-prefs") {
    await knock.users.unsetPreferences(me, "default");
    return { intent, result: "unset" };
  }

  return { intent, error: "Unknown intent" };
}

type FeedSnapshot = Pick<FeedStoreState, "items" | "metadata" | "loading">;

export default function KnockSpike({ loaderData }: Route.ComponentProps) {
  const d = loaderData;
  const fetcher = useFetcher<typeof action>();
  const feedRef = useRef<Feed | null>(null);
  const [feed, setFeed] = useState<FeedSnapshot | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [crossUser, setCrossUser] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const note = (s: string) =>
    setLog((l) => [`${new Date().toLocaleTimeString()} ${s}`, ...l].slice(0, 30));

  // Check 1 + 3: authenticate the headless client with the server-signed
  // token for whoever the DevUI selected. Re-runs on user switch.
  useEffect(() => {
    const client = new Knock(d.publicApiKey);
    client.authenticate({ id: d.knockUserId }, d.userToken);
    const f = client.feeds.initialize(d.feedChannelId);
    feedRef.current = f;
    const unsub = f.store.subscribe((s) =>
      setFeed({ items: s.items, metadata: s.metadata, loading: s.loading })
    );
    f.listenForUpdates();
    f.on("items.received.realtime", () => note("realtime: new item pushed"));
    f.fetch()
      .then((r) => {
        setFeedError(null);
        note(`feed fetched for user ${d.knockUserId}: ${JSON.stringify(r?.status ?? "ok")}`);
      })
      .catch((e) => setFeedError(String(e)));
    setFeed(null);
    setCrossUser(null);
    return () => {
      unsub();
      f.teardown();
      client.teardown?.();
    };
  }, [d.knockUserId, d.userToken, d.publicApiKey, d.feedChannelId]);

  // Negative half of check 1: my token must NOT read someone else's feed.
  const tryCrossUser = useCallback(async () => {
    if (!d.otherKnockUserId) return;
    const res = await fetch(
      `https://api.knock.app/v1/users/${d.otherKnockUserId}/feeds/${d.feedChannelId}`,
      {
        headers: {
          Authorization: `Bearer ${d.publicApiKey}`,
          "X-Knock-User-Token": d.userToken,
        },
      }
    );
    setCrossUser(`${res.status} ${(await res.text()).slice(0, 200)}`);
  }, [d]);

  const tokenClaims = decodeJwt(d.userToken);
  const f = feedRef.current;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 text-sm">
      <div className="rounded border-2 border-dashed border-amber-500 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        PROTOTYPE: Knock spike. Throwaway. Switch users in the DevUI panel to
        re-run every check as that user.
      </div>

      <Panel title="1. Signed user token">
        <p>
          Signed in as <b>{d.user.name}</b> ({d.user.role}), Knock id{" "}
          <code>{d.knockUserId}</code>
        </p>
        <Json value={tokenClaims} />
        <button className="btn" onClick={tryCrossUser} disabled={!d.otherKnockUserId}>
          Try reading user {d.otherKnockUserId}'s feed with this token (should fail)
        </button>
        {crossUser && <Json value={crossUser} />}
      </Panel>

      <Panel title="2. Trigger Discussion Reply → question author (me)">
        {d.replies.length === 0 ? (
          <p>
            No real replies to questions by this user in the seed DB. Switch to
            a user who asked a question.
          </p>
        ) : (
          d.replies.map((r) => (
            <fetcher.Form method="post" key={r.replyId} className="flex gap-2">
              <input type="hidden" name="intent" value="trigger-reply" />
              <input type="hidden" name="replyId" value={r.replyId} />
              <button className="btn">Trigger</button>
              <span>
                {r.replierName} replied “{r.replyBody.slice(0, 60)}” to “
                {r.questionBody.slice(0, 40)}”
              </span>
            </fetcher.Form>
          ))
        )}
      </Panel>

      <Panel title="3. Headless feed (list, unread count, mark read/seen)">
        {feedError && <p className="text-red-600">{feedError}</p>}
        <p>
          unread_count: <b>{feed?.metadata.unread_count ?? "…"}</b> · unseen_count:{" "}
          <b>{feed?.metadata.unseen_count ?? "…"}</b> · items:{" "}
          <b>{feed?.items.length ?? "…"}</b>
        </p>
        <div className="flex gap-2">
          <button className="btn" onClick={() => f?.fetch()}>Refetch</button>
          <button className="btn" onClick={() => f?.markAllAsSeen()}>Mark all seen</button>
          <button className="btn" onClick={() => f?.markAllAsRead()}>Mark all read</button>
        </div>
        <ul className="space-y-1">
          {feed?.items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 border-b py-1">
              <code>{item.source.key}</code>
              <span>{blockText(item.blocks)}</span>
              <span className="text-muted-foreground">
                seen:{item.seen_at ? "✓" : "–"} read:{item.read_at ? "✓" : "–"}
              </span>
              <button className="btn" onClick={() => f?.markAsSeen(item)}>seen</button>
              <button className="btn" onClick={() => f?.markAsRead(item)}>read</button>
              <button className="btn" onClick={() => f?.markAsUnread(item)}>unread</button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="4. Preferences: New Enrollment is off by default, opt-in">
        <p>This user's own preference set (empty = only the environment default applies):</p>
        <Json value={d.preferences} />
        <div className="flex gap-2">
          {(["trigger-enrollment", "opt-in", "reset-prefs"] as const).map((intent) => (
            <fetcher.Form method="post" key={intent}>
              <input type="hidden" name="intent" value={intent} />
              <button className="btn">{intent}</button>
            </fetcher.Form>
          ))}
        </div>
        <p className="text-muted-foreground">
          Expect: trigger-enrollment with no opt-in → nothing in the feed.
          opt-in, then trigger-enrollment → an item arrives.
        </p>
      </Panel>

      <Panel title="Last action result">
        <Json value={fetcher.data ?? null} />
      </Panel>
      <Panel title="Log">
        <Json value={log} />
      </Panel>
      <style>{`.btn{border:1px solid currentColor;border-radius:4px;padding:2px 8px}`}</style>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded border p-4">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function decodeJwt(token: string) {
  const [header, payload] = token.split(".").slice(0, 2).map((p) =>
    JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")))
  );
  return { header, payload };
}

function blockText(blocks: { name: string; rendered?: string; content?: string }[]) {
  const b = blocks.find((x) => x.name === "body") ?? blocks[0];
  return (b?.rendered ?? b?.content ?? "").replace(/<[^>]+>/g, "");
}

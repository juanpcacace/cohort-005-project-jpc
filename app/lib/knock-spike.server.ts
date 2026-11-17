// PROTOTYPE — throwaway Knock spike for "Does Knock hold up against Cadence?".
// Lives on the prototype/knock-spike branch only. Never merge.
import Knock, { signUserToken } from "@knocklabs/node";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "~/db";
import { comments, users } from "~/db/schema";

if (!process.env.KNOCK_SECRET_API_KEY) process.loadEnvFile(".env");

export const knock = new Knock({ apiKey: process.env.KNOCK_SECRET_API_KEY! });

export const knockPublicConfig = {
  publicApiKey: process.env.KNOCK_PUBLIC_API_KEY!,
  feedChannelId: process.env.KNOCK_FEED_CHANNEL_ID!,
};

export const ENROLLMENT_CATEGORY = "new-enrollment";

// Cadence user id → Knock user id. Plain stringified id.
export const knockUserId = (id: number) => String(id);

export async function identify(userId: number) {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) throw new Error(`No user ${userId}`);
  await knock.users.update(knockUserId(user.id), {
    name: user.name,
    email: user.email,
  });
  return user;
}

export function signTokenFor(userId: number) {
  return signUserToken(knockUserId(userId), {
    signingKey: process.env.KNOCK_SIGNING_KEY!,
    expiresInSeconds: 60 * 60,
  });
}

// Real replies in the seed DB whose question was written by `recipientId`
// and replied to by someone else — the Discussion Reply → question author case.
export function repliesToQuestionsBy(recipientId: number) {
  const question = db.$with("question").as(
    db
      .select({ id: comments.id, authorId: comments.userId, body: comments.body })
      .from(comments)
      .where(and(isNull(comments.parentId), isNull(comments.deletedAt)))
  );
  return db
    .with(question)
    .select({
      replyId: comments.id,
      replyBody: comments.body,
      replierId: comments.userId,
      replierName: users.name,
      lessonId: comments.lessonId,
      questionBody: question.body,
      questionAuthorId: question.authorId,
    })
    .from(comments)
    .innerJoin(question, eq(comments.parentId, question.id))
    .innerJoin(users, eq(users.id, comments.userId))
    .where(
      and(isNotNull(comments.parentId), eq(question.authorId, recipientId))
    )
    .all()
    .filter((r) => r.replierId !== recipientId);
}

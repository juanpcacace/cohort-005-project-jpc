# Running Knock locally and in tests

Research for issue #5 (child of map #2). This is a plan only, with no app code. Researched 2026-11-17.

**Question:** How can Cadence develop and test against Knock without real network calls, the way the Postmark mailer falls back to a local `.outbox/`? Covers environments, sandbox mode, mocking the Node SDK, identifying users, signed user tokens, and DevUI user switching.

## TL;DR

- Knock has **no local emulator and no offline mode**. Every SDK call hits `https://api.knock.app` (or `KNOCK_BASE_URL`). To work offline, Cadence needs its own seam, built like the old mailer's `MailTransport`.
- **Sandbox mode** exists, both per channel and per trigger (`settings.sandbox_mode`). It still needs a real API call, and it **does not apply to in-app feed channels**. It is useful for a real development environment, not for unit tests.
- **Tests:** inject a fake `NotificationTransport` (preferred, mirrors the mailer). Alternatively, pass a fake `fetch` into `new Knock({ fetch })`. Don't construct `Knock` without a key, because the constructor throws.
- **Users:** use `String(users.id)` as the Knock user id. Upsert through `client.users.update(id, {...})`, or through inline recipient objects on `workflows.trigger`.
- **Client feed:** in production, turn on enhanced security mode and sign a per-user JWT (RS256) server-side with `signUserToken`. Leave it off in development if needed.
- **DevUI switching** already works with the React SDK. A user switch submits a form, which redirects and runs the layout loader again. That passes a new `user.id` and `userToken` to `KnockProvider`, which reauthenticates and remounts the feed.

## 1. The local pattern to mirror

`app/lib/mailer.server.ts` is no longer on `main`, but it is in history at commit `42593ea` (with `app/lib/mailer.server.test.ts`). Its shape:

- `interface MailTransport { send(email): Promise<void> }`
- `postmarkTransport(token)` for real delivery, and `outboxTransport(dir)`, which writes one JSON file per email to `.outbox/`.
- `defaultTransport()` picks Postmark when `POSTMARK_SERVER_TOKEN` is set, otherwise the outbox.
- `sendEmail(email, transport = defaultTransport())` lets tests inject `outboxTransport(mkdtemp(...))` and assert on the files.

A Knock equivalent would look like this (sketch, not code to commit):

- `interface NotificationTransport { trigger(workflowKey, { recipients, actor?, data, tenant? }); identify(userId, props) }`
- `knockTransport(new Knock({ apiKey }))` for real calls.
- `outboxTransport(".outbox/knock")`, which writes the trigger payload as JSON.
- `defaultTransport()` uses Knock when `KNOCK_API_KEY` is set, otherwise the outbox.

This matters because the SDK constructor **throws** when no key is available: "The KNOCK_API_KEY environment variable is missing or empty; either provide it, or instantiate the Knock client with an apiKey option" ([knock-node `src/client.ts`](https://github.com/knocklabs/knock-node/blob/main/src/client.ts)). The client must therefore be created lazily, and only when the key is present.

## 2. Knock environments

Source: [Environments](https://docs.knock.app/concepts/environments).

- Accounts start with production only. Enabling environments adds **development** below it, and this can't be undone.
- Each environment has **isolated data**, meaning users, tenants, messages and logs, and its **own public/secret API key pair** (Platform > API keys).
- Content such as workflows is committed in development and then **promoted** to production. The API runs the last **committed** version of a workflow, while the dashboard test runner uses the last *saved* version ([Testing workflows](https://docs.knock.app/send-notifications/testing-workflows)).
- Provider credentials are not copied between environments. A new environment "will not send anything until you … reconfigure your provider credentials for each channel."

For Cadence, the development environment's keys go in a developer's `.env`. Production keys go only in the deployment. With no key, the local outbox is used.

## 3. Sandbox and test mode

- **Per-channel sandbox mode** is set under Advanced in each channel's environment settings. Knock generates and previews messages but never calls the downstream provider. It is supported "across all channel types (**except for in-app**)" ([Integrations overview](https://docs.knock.app/integrations/overview)).
- **Per-trigger:** `settings: { sandbox_mode: true, skip_delay: true }` on the workflow trigger body, "useful for programmatic testing" ([Trigger API](https://docs.knock.app/api-reference/workflows/trigger), [Testing workflows](https://docs.knock.app/send-notifications/testing-workflows)).
- The **dashboard test runner** and the CLI `workflow run` command support manual end-to-end checks of a workflow ([Testing workflows](https://docs.knock.app/send-notifications/testing-workflows)).
- In test runs, "once per recipient"-style frequency limits are bypassed.

Sandbox mode still needs network access and a real environment key, so it **is not a replacement for a local fallback** in Vitest. It is also irrelevant to the in-app feed.

## 4. Mocking the Node SDK (`@knocklabs/node` v1)

Source: [knock-node README](https://github.com/knocklabs/knock-node) and [`api.md`](https://github.com/knocklabs/knock-node/blob/main/api.md).

- Construct the client with `new Knock({ apiKey })`. `apiKey` defaults to `KNOCK_API_KEY`, and `baseURL` defaults to `KNOCK_BASE_URL` or `https://api.knock.app`.
- Other client options include `fetch` (a custom fetch implementation), `maxRetries` (default 2), `timeout` (default 60s), and `logLevel`.
- The README documents no testing or mocking guidance. The options in order of preference:
  1. **Inject a transport (recommended).** Domain code depends on `NotificationTransport`, and tests pass an in-memory or outbox fake and assert on the recorded calls. This is the same as `mailer.server.test.ts`. The SDK is never imported in tests.
  2. **Fake `fetch`.** Use `new Knock({ apiKey: "sk_test_fake", fetch: fakeFetch, maxRetries: 0 })` and assert on request URL and body. This is useful for one adapter test of `knockTransport` itself.
  3. `vi.mock("@knocklabs/node")`. This works, but it couples tests to SDK internals, so avoid it.
- Errors are `Knock.APIError` subclasses, so test the adapter's failure path with a fake `fetch` that returns 4xx or 5xx.

## 5. Identifying and syncing users

Sources: [Users](https://docs.knock.app/concepts/users) and [Identifying recipients](https://docs.knock.app/managing-recipients/identifying-recipients).

- Only `id` is required, and `email` is required for email channels. Ids can be up to 256 characters, can't contain `/` or `#`, and **can never be changed**. Knock recommends your internal primary key.
  - Cadence `users.id` is an autoincrement integer (`app/db/schema.ts`), so send `String(user.id)`.
- A user must be identified before Knock can notify or reference them. "All identification methods in Knock use an upsert approach."
- There are two ways to sync:
  - **Explicit identify:** `client.users.update(userId, { name, email })` → `PUT /v1/users/{id}`. Call it on signup and on profile change.
  - **Inline identify:** pass recipient *objects* (`{ id, name, email }`) instead of strings in `workflows.trigger`. "Knock guarantees that recipients are identified before executing any other action." Plain id strings don't identify.
- Inline identify is the simplest fit for Cadence. It needs no separate sync job, and every trigger carries fresh data, which fits the transport seam. Seeded dev users get identified the first time they're notified.
- `KnockProvider` also identifies the user inline from the client by default (`identificationStrategy: "inline"`). This can be set to `"skip"` ([KnockProvider](https://docs.knock.app/in-app-ui/react/sdk/components/knock-provider)).
- Deleted users show as "missing user" in old in-app messages.

## 6. Signed user tokens (enhanced security mode)

Source: [Security & authentication](https://docs.knock.app/in-app-ui/security-and-authentication).

- Without enhanced security, "a public key can act as any user," and feeds are readable by anyone with the feed id. Turn it on in **production** before launch. It is **per environment**, so it can stay off in development.
- **Token:** a JWT signed **RS256** with the environment's signing key (dashboard > API keys, shown once). The key goes in the `KNOCK_SIGNING_KEY` environment variable, base64 form if the PEM errors.
  - Claims are `sub` (the user id, required) plus `iat`/`exp`. Grants can be narrowed with `explicit_grants`.
- **Node helper:** `import { signUserToken } from "@knocklabs/node"` and call `await signUserToken(String(userId), { expiresInSeconds })`. This is local signing with no network call. The default expiry is 3600s, and the docs suggest matching the session lifetime or refreshing via `onUserTokenExpiring`.
- **Client:** pass the token to `KnockProvider userToken={...}`. Some feed docs say `KnockFeedProvider`, but the current provider API puts `userToken` on `KnockProvider` ([KnockProvider](https://docs.knock.app/in-app-ui/react/sdk/components/knock-provider)).
- In Cadence, sign the token in the loader that already resolves `getCurrentUserId` (`app/routes/layout.app.tsx`) and return it in `loaderData`. Return `null` when there is no user or no signing key.

## 7. DevUI user switching and the client feed

Local flow: `DevUI` posts to `/api/switch-user` → `setCurrentUserId` rewrites the `cadence_session` cookie → redirect to `redirectTo` → the layout loader runs again with the new user (`app/routes/api.switch-user.ts`, `app/lib/session.ts`).

React SDK behavior, from source: [`useAuthenticatedKnockClient`](https://github.com/knocklabs/javascript/blob/main/packages/react-core/src/modules/core/hooks/useAuthenticatedKnockClient.ts):

- If the client is authenticated and the user id or token changes, it calls `knock.authenticate(...)` again in place. "A userId change still remounts the feed subtree downstream because `feedProviderKey` includes the userId." The token docs also note that reauthenticating restarts the real-time socket.
- `enabled={Boolean(userId && userToken)}` keeps the client idle until a complete identity exists. Without it, "a present `userId` with a not-yet-loaded token fires 401s." Setting `enabled` to `false` disconnects and clears stores, like a logout.

The result is that the DevUI needs no Knock-specific code. When the loader returns the new `knockUserId` and `knockUserToken`, the feed switches users. For "No user selected", pass `enabled={false}`.

One local-dev caveat: the in-app feed **reads from Knock's API**, so with no Knock key there is no feed to show. One option is a dev-only fallback component that lists recent `.outbox/knock` entries for the current user. The other is to just render nothing.

## Open questions for the spec

1. Should local dev without a Knock key render a fake feed from the outbox, or just hide the bell?
2. Should the team use a shared Knock **development** environment or one per developer? Data isn't isolated between developers who share an environment, and seeded user ids 1..N collide.
3. Should enhanced security be enabled in development too, so token bugs show up before production? If so, every developer needs `KNOCK_SIGNING_KEY`.
4. What should the token lifetime be? The 1h default and the `onUserTokenExpiring` refresh need to fit the cookie session, which currently has no `maxAge`.
5. Inline identify only, or also `users.update` on profile edits? Inline only means a stale name or email until the next trigger.
6. Should id strings carry a prefix (e.g. `cadence-42`) to avoid collisions if environments or apps are ever shared? Ids can't change later.
7. Should triggers be awaited in the request, or fired after the response? This affects failure handling when Knock is down.

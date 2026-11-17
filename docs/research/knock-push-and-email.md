# Knock: web push and email channels

Research for issue #4 (child of map #2). Researched 2026-11-17 against Knock's docs and the push and email providers' own docs. This is a plan only. No app code was written.

## Question

1. Which web push providers can Knock deliver through, and what does a browser-only setup take (service worker, VAPID, permission prompt, token registration)?
2. How is Postmark configured as Knock's email provider?
3. Can Knock send plain-text emails like Cadence sends today?
4. What are the free-tier limits?

## Repo context

The ticket says Cadence sends plain-text email through Postmark from `app/lib/mailer.server.ts`. That file does not exist on `main` (commit `b741ddd`), and nothing in the repo mentions Postmark. The current email integration is either on another branch or still planned. The spec should confirm which.

## 1. Web push

### Supported push providers

Knock's push integrations are Amazon SNS, APNs, Expo, Firebase Cloud Messaging (FCM) and OneSignal. Source: [Push overview](https://docs.knock.app/integrations/push/overview) and the [docs index](https://docs.knock.app/llms.txt).

Knock says plainly: "Knock does not have a first-party web push channel. Instead, you'll use FCM to send messages to a user's browser." Source: [Tutorial: Sending web push notifications with FCM](https://docs.knock.app/tutorials/sending-web-push-notifications-with-fcm).

- **FCM** is the only provider Knock documents for web push. The FCM integration page says FCM can "send mobile or web push notifications" and lists a `webpush` override key. Source: [Firebase (FCM)](https://docs.knock.app/integrations/push/firebase).
- **OneSignal**: Knock's page describes it as "mobile push" and assumes you have "already integrated the OneSignal SDK within your application". In the default External ID mode, Knock passes the Knock user ID as OneSignal's `external_id` and uses OneSignal's "Aliases" targeting, so no channel data is stored in Knock. Source: [OneSignal](https://docs.knock.app/integrations/push/one-signal). OneSignal itself offers web push. Whether a OneSignal web subscription linked to that external ID would get Knock's sends is **my inference, not documented by Knock**.
- **APNs, Expo and SNS** are native or mobile only and don't apply here.

**Recommendation:** use FCM. It's the documented path, and Knock stores and cleans up its tokens.

### Browser-only setup with FCM and Knock

Every step below comes from the Knock FCM web push tutorial unless another source is named.

1. **Firebase project.** Create one and add a web app to get the Firebase config object (apiKey, projectId, messagingSenderId, appId and so on).
2. **VAPID key.** In the Firebase console, go to Cloud Messaging, then Web configuration, then the Web Push certificates tab, and generate a key pair. The public key goes into client code. Source: [Firebase: Receive messages in a JS client](https://firebase.google.com/docs/cloud-messaging/js/client). You do not give the VAPID key to Knock.
3. **Knock FCM channel.** It needs the **Project ID** and the **complete Service Account JSON**, configured per environment. Source: [Firebase (FCM)](https://docs.knock.app/integrations/push/firebase).
4. **Service worker.** FCM requires a `firebase-messaging-sw.js` file at the site root, which in React Router is `public/`. It loads the Firebase compat scripts from gstatic and initializes `firebase.messaging()`. It can't read build-time env vars, so the Firebase config has to be hardcoded or templated into it. The site must be served over HTTPS.
5. **Client init.** Call `initializeApp` and `getMessaging`, then `navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" })`. This runs client-side only, so in Cadence it belongs in a `useEffect` or a client-only module.
6. **Permission prompt.** Show it only after a user action, such as a "Turn on browser notifications" button. Call `Notification.requestPermission()` and stop unless the result is `"granted"`. Unsubscribing at the browser level can't be done from JavaScript. An app-level unsubscribe means clearing the token in Knock.
7. **Get the token.** Call `getToken(messaging, { vapidKey, serviceWorkerRegistration })`.
8. **Register the token in Knock.** With the browser client (`@knocklabs/client`, or `useKnockClient` in `@knocklabs/react`):
   `knock.user.setChannelData({ channelId: KNOCK_FCM_CHANNEL_ID, channelData: { tokens: [token] } })`.
   - **Overwrite gotcha:** "channel data will always be overwritten with each `set` call." Source: [Setting channel data](https://docs.knock.app/managing-recipients/setting-channel-data). A user with several browsers needs a read-merge-write step, or else one token per user.
   - **Auth:** the browser client uses Knock's public API key plus a user token, an RS256 JWT with `sub` set to the user ID. Cadence's server would sign it with Knock's private signing key. In enhanced security mode, Knock rejects public-key calls that lack a token. By default a token can write its own channel data (`PUT /v1/users/:id/channel_data/:channel_id`) unless `explicit_grants` restricts it. Source: [Security and authentication](https://docs.knock.app/in-app-ui/security-and-authentication).
   - **Server-side alternative:** POST the token to a Cadence action, which calls Knock's `users.setChannelData` with the secret key. This avoids needing the browser SDK and JWT signing just for push.
9. **Token hygiene.** FCM `UNREGISTERED` errors mean the token should be removed. Knock's optional token deregistration removes tokens when a send bounces. Sources: [Firebase (FCM)](https://docs.knock.app/integrations/push/firebase) and [Token deregistration](https://docs.knock.app/integrations/push/token-deregistration).
10. **Message types.** Knock sends FCM *notification* messages by default, and the browser shows them automatically when the tab is in the background. In the foreground, the app's `onMessage` handler must show them. Use a `webpush` override for icon and badge. Data-only messages need a `"__strategy__": "replace"` override plus `onBackgroundMessage` in the service worker. Source: the FCM tutorial.
11. **iOS Safari.** The tutorial's sample code blocks subscription on iPhone unless the site is installed to the Home Screen as a PWA.

**Firebase API drift (open risk):** Firebase's current JS client docs mark `getToken({ vapidKey })` as deprecated ("will be removed in a future release"). They recommend `register()` and `onRegistered()`, which return a Firebase Installation ID (FID). Knock's tutorial still uses `getToken`. Knock's docs don't say whether its FCM channel accepts FIDs in the `tokens` field. Source: [Firebase: Receive messages in a JS client](https://firebase.google.com/docs/cloud-messaging/js/client).

## 2. Postmark as Knock's email provider

Source: [Knock: Postmark](https://docs.knock.app/integrations/email/postmark). These settings are configured per environment under Channels and sources.

- **Required:** the Postmark server **API key** and a **From email address**, which supports Liquid.
- **Optional:**
  - Incoming webhook for delivery status.
  - Sandbox mode.
  - Knock open and link tracking.
  - Postmark's own open and link tracking, marked "(provider)".
  - CSS inlining, on by default.
  - From name, To, Cc, Bcc and Reply-to overrides.
  - JSON **payload overrides** merged into the Postmark API request.
- **Message stream:** Knock doesn't set `MessageStream`, so sends go to Postmark's default `"outbound"` transactional stream. To use another stream, add a payload override such as `{"MessageStream": "broadcasts"}`.
- **Delivery webhooks:** require a verified sender signature or domain in Postmark. Paste Knock's webhook URL into the stream's Webhooks tab and select Delivery, Bounce and Spam complaint. Delivery maps to `delivered` and Bounce maps to `bounced`. A spam complaint logs `message.complaint` without changing the status.
- Each recipient needs an `email` property on the Knock user.

## 3. Plain-text email

- Knock email templates are built around HTML. The template schema requires either `html_body` or `visual_blocks`. `text_body` is optional and is "autogenerated from the html_body or visual_blocks" when omitted. Source: [mAPI EmailTemplate schema](https://docs.knock.app/mapi-reference/templates/schemas/email_template).
- Layouts have a separate **Text** tab, and the template's text body is injected into `{{content}}` there. Source: [Email layouts](https://docs.knock.app/integrations/email/layouts).
- So Knock **can send a hand-written plain-text part**, either by setting `text_body` or by editing the text version, alongside the HTML part. I found **no documented setting for text-only email** (no HTML part).
- Postmark accepts text-only email: `HtmlBody` is required only "If no `TextBody` specified". Source: [Postmark Email API](https://postmarkapp.com/developer/api/email-api).
- **Untested workaround:** a Postmark payload override that removes `HtmlBody`, such as `{"HtmlBody": null}`. Knock doesn't document merge semantics for keys like this. Source: [Email settings and overrides](https://docs.knock.app/integrations/email/settings). This needs a spike before anyone relies on it.
- **Practical answer:** keep a minimal HTML body, such as the text in a `<pre>` or simple paragraphs, with a matching hand-written `text_body`. Plain-text-only clients will then see Cadence's current text exactly.

## 4. Free-tier limits

Source: [Knock pricing](https://knock.app/pricing).

- **Developer (free):**
  - Up to **10,000 messages sent per month**.
  - **Unlimited** delivery channels, environments and team members.
  - 500 guide recipients per month and 500 agent credits per month.
  - Excludes Knock branding removal, email client previews, translations (i18n), per-tenant branding and preferences, audit logs, custom roles, and SSO/SCIM.
- **Starter:** $250/month. It includes 50,000 messages, then $0.005 per message.
- The pricing page doesn't say whether exceeding 10,000 messages on the free plan is a hard cap or blocks sends.
- Knock's quota is separate from Postmark's own sending limits and billing, and FCM itself is free.

## Open questions for the spec

1. Does `app/lib/mailer.server.ts` with Postmark exist on another branch, or is the Postmark integration part of this work?
2. Must Cadence emails be strictly text-only (no HTML part), or is HTML with a hand-written plain-text part acceptable? If strictly text-only, someone needs to spike the `HtmlBody` payload override.
3. Should push token registration go browser to Knock (needs the Knock client SDK and server-signed user JWTs, with enhanced security on) or browser to Cadence server to Knock (secret key only)?
4. Should Cadence support several browsers per user? If so, it needs read-merge-write of the `tokens` array, because `setChannelData` overwrites.
5. Should Cadence use `getToken` as Knock's tutorial does, or the newer FID `register()` API Firebase now recommends? This needs confirmation from Knock that FIDs work as FCM channel tokens.
6. Is iOS Safari, which requires installing the site as a PWA, in scope?
7. Is 10,000 messages per month (email plus push combined) enough for expected volume, and what happens at the cap?

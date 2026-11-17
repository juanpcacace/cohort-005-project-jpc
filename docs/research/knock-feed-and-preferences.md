# Knock: in-app feed, preferences and React components

Research for issue #3 (child of map #2, "Notifications in Cadence"). Researched 2026-11-17 against Knock's docs and the `knocklabs/javascript` SDK source (`main`, `@knocklabs/react` 0.15.1). Plan only, no app code.

Cadence context: React 19, React Router 8 (SSR), Tailwind 4, shadcn. Today `app/components/ui/` has `button`, `card`, `input`, `label`, `select`, `skeleton`, `tabs` and `textarea`, with no popover, switch or checkbox yet.

## 1. Feed model

- A feed is a list of FeedItems. Knock generates each item ahead of time when a workflow or broadcast runs for a recipient. Items come back in reverse chronological order. [Feeds overview](https://docs.knock.app/in-app-ui/feeds/overview)
- **Content can't be changed once generated.** In Knock's words: "content and other metadata can't be changed once Knock generates it." To correct a message, archive it and trigger the workflow again. [Feeds overview](https://docs.knock.app/in-app-ui/feeds/overview) (This matters for map #2's open question about a course being unpublished or a Purchase refunded after its Notification was sent.)
- The feed endpoint is `GET /v1/users/{user_id}/feeds/{channel_id}`. Query params: `status`, `archived`, `tenant`, `has_tenant`, `source`, `workflow_categories`, `trigger_data`, `locale`, `mode`, `exclude`, `after`/`before` (cursor), `page_size` (default 50) and `inserted_at.*`. The response `meta` holds `total_count`, `unread_count` and `unseen_count`. Item fields: `id`, `blocks` (rendered template content), `data`, `activities`, `actors`, `total_activities`, `total_actors`, `source`, `tenant`, `inserted_at` and `updated_at`. [List feed items](https://docs.knock.app/api-reference/users/feeds/list_items)
- Feed `mode` is `compact` by default and leaves out some fields. Pass `{ mode: "rich" }` to get the full FeedItem. [Headless feed](https://docs.knock.app/in-app-ui/react/headless/feed)

### Engagement states

- The engagement statuses are `seen`, `read`, `link_clicked`, `interacted` and `archived`, each with a `*_at` timestamp. Knock calls them "mutually inclusive": an item can have several of them at once, or none. Delivery status (sent, delivered and so on) is a separate axis. [Message statuses](https://docs.knock.app/send-notifications/message-statuses)
- **Every status can be reversed from the client.** The feed client (`packages/client/src/clients/feed/feed.ts`) has `markAsSeen`/`markAsUnseen`, `markAsRead`/`markAsUnread`, `markAsInteracted`, `markAsArchived`/`markAsUnarchived`, plus the bulk methods `markAllAsSeen`, `markAllAsRead`, `markAllAsArchived` and `markAllReadAsArchived`. Updates are applied optimistically to the local store. [SDK source](https://github.com/knocklabs/javascript/blob/main/packages/client/src/clients/feed/feed.ts)
- **Archived items are excluded by default.** The feed client defaults to `archived: "exclude"`, and archiving an item removes it from the list. The other options are `"include"` and `"only"` (for an "Archive" tab). [SDK source](https://github.com/knocklabs/javascript/blob/main/packages/client/src/clients/feed/feed.ts), [API overview](https://docs.knock.app/in-app-ui/api-overview)
- **Badge count:** `unseen_count` "usually drives badge counts". `unread_count` counts items the user hasn't engaged with. `NotificationIconButton` takes `badgeCountType` (`"unseen"` by default, or `"unread"`). [Headless feed](https://docs.knock.app/in-app-ui/react/headless/feed), [React feed](https://docs.knock.app/in-app-ui/react/feed)
- **Default behaviour of the prebuilt popover:** opening it marks all items as seen, and clicking an item marks it as read. Override `onOpen` to change this. The headless hooks mark nothing on their own, so you call `markAllAsSeen()` and the other methods yourself. [React feed](https://docs.knock.app/in-app-ui/react/feed), [Headless feed](https://docs.knock.app/in-app-ui/react/headless/feed)

## 2. React: prebuilt components vs headless hooks

### Packages

- `@knocklabs/client`: a vanilla JS client with the feed, socket and preferences APIs.
- `@knocklabs/react-core`: its README says "A set of shared components, hooks, and utilities for working with React and React Native Knock packages. **Not meant to be consumed externally.**" [README](https://github.com/knocklabs/javascript/blob/main/packages/react-core/README.md)
- `@knocklabs/react`: the package to install. It re-exports the react-core hooks (`KnockProvider`, `KnockFeedProvider`, `useKnockClient`, `useKnockFeed`, `useNotifications`, `useNotificationStore`, `useCreateNotificationStore`, `useFeedSettings`, `usePreferences` and the i18n helpers) alongside the UI components. [index.ts](https://github.com/knocklabs/javascript/blob/main/packages/react/src/index.ts)

**So "headless" in practice means importing the hooks from `@knocklabs/react` without rendering its components**, not depending on `@knocklabs/react-core` directly. Caveat: `@knocklabs/react`'s entry file has `import "./theme.css"`, so importing hooks from it may still pull in Knock's global stylesheet. It declares tokens under `:root` and classes prefixed with `rnf-`. The package also ships `/next` and `/tanstack` subpath exports, but none for React Router. Verify the CSS side effect in a prototype.

### Prebuilt components

The exported feed components are `NotificationIconButton`, `UnseenBadge`, `NotificationFeedPopover`, `NotificationFeed`, `NotificationFeedContainer`, `NotificationFeedHeader`, `NotificationCell`, `MarkAsRead`, `EmptyFeed` and `Avatar`. [index.ts](https://github.com/knocklabs/javascript/blob/main/packages/react/src/index.ts)

How far they can be restyled ([React feed](https://docs.knock.app/in-app-ui/react/feed), [theme.css](https://github.com/knocklabs/javascript/blob/main/packages/react/src/theme.css)):

- **CSS variables:** `--rnf-*` (font sizes, spacing, weights, font family, radii, shadows, a gray scale and brand colors) and the newer `--knock-*` tokens. These can be mapped onto shadcn's tokens (for example `--rnf-color-brand-500: var(--primary)`).
- **Dark mode:** `colorMode="dark"` on `KnockFeedProvider`. This is a prop, not the `.dark` class or `prefers-color-scheme`, so it would have to be wired to Cadence's theme.
- **Replacing the CSS entirely:** drop Knock's stylesheet and target the `rnf-` classes.
- **Render props:** `renderItem` replaces a cell entirely, `NotificationCell` accepts `children` and `avatar`, and `NotificationFeed` takes `renderHeader`.
- The docs don't mention a `className` or `theme` prop, so the components can't be styled with Tailwind utilities directly.

**Assessment:** restyling the prebuilt popover to look native to shadcn is possible but fiddly. You would map `--rnf-*` to shadcn tokens, sync `colorMode` by hand and accept Knock's DOM structure and focus behaviour. The headless hooks plus shadcn `Popover`, `Button`, `Tabs` and `ScrollArea` (not yet installed) give full control. Knock's own docs recommend that path for a custom look. Knock's example is the "Notion feed example" repo. [Headless feed](https://docs.knock.app/in-app-ui/react/headless/feed)

Headless shape:

```tsx
const knock = useKnockClient();
const feed = useNotifications(knock, FEED_CHANNEL_ID, { archived: "exclude" });
const { items, metadata, loading } = useNotificationStore(feed);
useEffect(() => { feed.fetch(); }, [feed]);
// feed.markAllAsSeen() on open; feed.markAsRead(item) on click; feed.fetchNextPage() for paging
```

## 3. Real-time vs polling

- Knock's real-time service is a WebSocket (Phoenix channels in the SDK's `socket-manager.ts`). It sends a `new-message` event when a message is produced. The event carries badge-count metadata but not the message itself, and Knock says it "Might be throttled". [API overview](https://docs.knock.app/in-app-ui/api-overview)
- When an event arrives, the SDK fetches only the items newer than the current head (`fetch({ before: currentHead.__cursor })`). [SDK source](https://github.com/knocklabs/javascript/blob/main/packages/client/src/clients/feed/feed.ts)
- **Polling:** neither the docs nor the SDK mention a built-in polling mode. Real time is the default once the feed client has called `listenForUpdates` (the providers and hooks do this). Polling, or fetching on page load only, is something Cadence would implement itself (for example by calling `feed.fetch()` in a loader or on an interval).
- Options: `auto_manage_socket_connection` (with `auto_manage_socket_connection_delay`) disconnects the socket while the tab is hidden. `__experimentalCrossBrowserUpdates` syncs status changes across tabs through `BroadcastChannel`. [React feed](https://docs.knock.app/in-app-ui/react/feed)
- **Auth/security:** the client uses the public API key. Without **enhanced security mode**, "a request with your public key can act as any user". Knock recommends enabling it for production. With it on, the backend signs an RS256 JWT (`sub` = user id) using `signUserToken` from `@knocklabs/node` (default expiry 3600s) and passes it as `userToken` to `KnockProvider`. `onUserTokenExpiring` handles refresh. [Security and authentication](https://docs.knock.app/in-app-ui/security-and-authentication)

## 4. Preferences

### Model

([Preferences overview](https://docs.knock.app/preferences/overview))

- Each recipient has a `PreferenceSet` with the keys `workflows`, `categories`, `channel_types` (email, push, in_app_feed and so on) and `channels` (a specific channel by UUID). The `default` set also has `commercial_subscribed`. Values are booleans, or nested objects such as `{ channel_types: {...} }` for a workflow-by-channel grid, and can carry **conditions** (for example per-resource muting).
- **Users are opted in by default.** Unset preferences count as `true`. To opt everyone out of a channel by default, set it to `false` in the environment default set.
- **Evaluation:** a message sends only if all applicable preferences are `true`. One `false` category blocks the send even when the channel type is `true`. A channel-level value overrides its channel type.
- **Defaults and layering:** recipient set, then tenant default, then environment default. Higher layers win and lower layers fill gaps. `__strategy__: "replace"` lets a default override a user's own choice.
- **Mandatory Notifications:** a workflow-level "Override recipient preferences" setting sends on all channels regardless of preferences. Refund receipts would be a candidate.
- Multiple sets (`default`, per-tenant, object preferences) are identified by `id`. **Per-tenant preferences need Enterprise** (see section 6).

### UI

- **Hosted preference center:** a no-code page that Knock renders, reached through a signed URL (`POST /v1/users/{id}/preference_center/signed_url`). It is served from `p.knock.app` or a custom subdomain. Rows, labels and branding are configured in the dashboard. **It supports only the `default` set.** It's a separate page rather than an embedded component, and fits email footers (`manage_preferences_url`). [Preferences overview](https://docs.knock.app/preferences/overview), [Signed URL API](https://docs.knock.app/api-reference/users/preference_center/generate_signed_url)
- **No prebuilt React preferences component.** Knock's React guide has you build `PreferenceCenter`/`PreferenceSettingsRow` yourself. [React preferences](https://docs.knock.app/in-app-ui/react/preferences)
- The **`usePreferences` hook** (SWR-backed, exported from `@knocklabs/react`) returns `{ preferences, setPreferences, getAllPreferences, isLoading, isValidating }` and takes `{ preferenceSet, tenant }`. [usePreferences.ts](https://github.com/knocklabs/javascript/blob/main/packages/react-core/src/modules/preferences/hooks/usePreferences.ts)
- **`setPreferences` replaces the whole set by default**, so send the complete set or follow the FAQ's partial-update approach. [Custom preference center](https://docs.knock.app/preferences/custom-preference-center)
- **Dashboard-managed row config:** `GET /v1/users/{id}/preference_center/config` returns rows (`type`: `workflow` | `channel` | `category` | `channel_types` | `commercial_subscribed`, plus name, description, identifier and channel_types). A custom shadcn UI can render this, so labels live in Knock rather than in code. The config is per environment. [Custom preference center](https://docs.knock.app/preferences/custom-preference-center)

## 5. Batching and digests

([Batch function](https://docs.knock.app/designing-workflows/batch-function))

- The **batch step** opens a window on a recipient's first trigger and collects later triggers as `activities` until the window closes. The window can be fixed, dynamic (from trigger data or a rule), or **sliding** (extended on each trigger up to a max). The longest window is 90 days.
- **`batch_key`** splits batches further: one batch per `recipient + key`, for example per course.
- Optionally the batch closes early after 2 to 1000 activities. Templates render up to 10 `activities`/`actors` (100 on Enterprise). `total_activities`/`total_actors` always hold the full counts, as in "X and 7 others commented".
- The in-app feed item is created after the batch closes, carrying `total_activities` (>1 only for batches). The docs don't say whether an item updates in place during an open window. In the step-based model nothing reaches the channel until the window closes. Unverified; confirm in a prototype.
- **Digests:** Knock says batching "isn't well suited" to recurring daily or weekly digests with fixed send times. For those, it recommends a scheduled workflow that pulls the events from your own system at send time.

## 6. Free tier

([Pricing](https://knock.app/pricing))

- **Free ($0/month):** 10,000 messages/month, unlimited workflows, team members and environments, batching, preferences, in-app feeds, the Feed API and 30-day log retention. **No hard cap:** if you go over without billing set up, Knock contacts you.
- **Not on Free:** removing Knock branding (likely visible on the hosted preference center and email), translations/i18n, **per-tenant branding and preferences**, custom roles, audit logs, SSO and data streams.
- **Starter ($250/month):** 50k messages, then $0.005 each, branding removal and email previews.
- **Enterprise:** i18n, per-tenant preferences, 90-day logs and a 100-item batch render limit.

## Open questions this raises for the spec

1. **Inbox UI:** use the headless hooks with shadcn (adding Popover, ScrollArea and maybe Switch/Checkbox), or restyle Knock's popover? The findings lean towards headless.
2. **Seen vs read semantics:** does the badge count unseen (cleared when the Inbox opens) or unread (cleared per item)? Should items be archivable, and should there be an "Archived" view?
3. **Real time vs refreshing on page load:** both are cheap. Real time is the SDK default and needs enhanced security mode with a server-signed user token in the root loader.
4. **Preferences UI:** a custom in-app page (`usePreferences`, possibly driven by the dashboard row config), the hosted page (default set only, Knock branding on Free), or both, with the hosted page for email footers?
5. **Preference granularity:** workflow by channel type, or category by channel type? Which Notifications are mandatory ("Override recipient preferences", for example refund emails)? Opt-in by default?
6. **Team Admin and teams:** Team-scoped preferences would need tenants and per-tenant preferences, which is Enterprise-only, so model teams in the preference keys or skip that.
7. **Batching:** which Notifications batch (and on what `batch_key`)? Is there a periodic digest, which Knock says to build as a scheduled pull rather than a batch?
8. **Immutable feed content:** when a course is unpublished or a Purchase refunded, archive the old Notification (and send a new one), or leave it?
9. **SSR:** `@knocklabs/react` ships with `"use client"` and global CSS but no React Router entry. Check that hooks render cleanly under React Router SSR, or mount them client-only.

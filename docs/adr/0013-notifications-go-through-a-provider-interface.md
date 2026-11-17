# Notifications go through a provider interface; the browser never talks to the vendor

Cadence delivers Notifications through a hosted vendor (Knock today), but every use of it goes through one server-side interface written in Cadence's own terms: sending a Notification to its recipients, reading and changing a person's Notification Preferences, and reading and marking their Notification Feed. Vendor concepts like workflows, categories, channels and signed user tokens stay inside the vendor's implementation, and the browser only ever calls Cadence, never the vendor. We accept an extra layer and an extra hop on every Feed request so that moving to another provider means writing one new implementation, with no change to callers or the UI, and so tests can use an in-memory fake.

## Considered Options

- **Use the vendor's SDK directly** (Knock's client SDK in the browser, its Node SDK at each trigger site): less code, and real-time updates for free, but the vendor's names and response shapes would spread through the app.
- **A client-side interface as well, with the browser still calling the vendor**: avoids the hop, but means two interfaces, and auth stays specific to the vendor.

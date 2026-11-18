import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../app/db/schema";
import { defaultNotificationsProvider } from "../app/lib/notifications.server";
import { syncAllNotificationUsers } from "../app/lib/users.server";

// One-off backfill: syncs every existing user to the Notifications provider
// (name, email, avatar) and writes the default Notification Preferences for
// anyone who has none yet. Safe to re-run: changed preferences are kept.
//
//   npm run notifications:sync-users

const db = drizzle(new Database("data.db"), { schema });

syncAllNotificationUsers(db, defaultNotificationsProvider())
  .then((count) => console.log(`Synced ${count} users.`))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

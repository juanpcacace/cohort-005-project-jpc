import { db } from "~/db";
import { readLandingPage, type LandingPage } from "./lib/landing-page";

export type {
  LandingPage,
  FeaturedCourse,
  LandingStats,
} from "./lib/landing-page";

/** Everything the public landing page (`/`) shows about the catalogue. */
export function getLandingPage(): LandingPage {
  return readLandingPage(db);
}

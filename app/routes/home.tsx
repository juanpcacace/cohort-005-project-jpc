import type { Route } from "./+types/home";
import { eq } from "drizzle-orm";
import { db } from "~/db";
import { users } from "~/db/schema";
import { DevUI } from "~/components/dev-ui";
import { LandingHeader } from "~/components/landing/landing-header";
import { LandingHero } from "~/components/landing/landing-hero";
import {
  LandingFeaturedCourses,
  LandingFeatures,
  LandingFooter,
  LandingStatsStrip,
} from "~/components/landing/landing-sections";
import { getLandingPage } from "~/modules/landing/index.server";
import { getCurrentUserId, getDevCountry } from "~/lib/session";
import { getCountryTierInfo, COUNTRIES } from "~/lib/ppp";

export function meta() {
  return [
    { title: "Cadence — Learn at your own pace" },
    {
      name: "description",
      content:
        "A modern course platform for developers. Browse courses, track your progress, and learn at your own pace.",
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { featuredCourses, stats } = getLandingPage();
  const allUsers = db.select().from(users).all();
  const currentUserId = await getCurrentUserId(request);
  const currentUser = currentUserId
    ? db.select().from(users).where(eq(users.id, currentUserId)).get()
    : null;
  const devCountry = await getDevCountry(request);

  return {
    featuredCourses,
    stats,
    users: allUsers.map((u) => ({ id: u.id, name: u.name, role: u.role })),
    currentUser: currentUser
      ? { id: currentUser.id, name: currentUser.name, role: currentUser.role }
      : null,
    devCountry,
    countryTierInfo: getCountryTierInfo(devCountry),
    countries: COUNTRIES,
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { featuredCourses, stats, currentUser } = loaderData;
  const signedIn = currentUser !== null;

  return (
    <div className="min-h-screen bg-background">
      <LandingHeader signedIn={signedIn} />
      <LandingHero
        signedIn={signedIn}
        stats={stats}
        featuredCourses={featuredCourses}
      />
      <LandingStatsStrip stats={stats} />
      <LandingFeatures />
      <LandingFeaturedCourses courses={featuredCourses} />
      <LandingFooter signedIn={signedIn} />
      <DevUI
        users={loaderData.users}
        currentUser={currentUser}
        devCountry={loaderData.devCountry}
        countryTierInfo={loaderData.countryTierInfo}
        countries={loaderData.countries}
      />
    </div>
  );
}

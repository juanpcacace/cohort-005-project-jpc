import { Link } from "react-router";
import { ClipboardCheck, Layers, LineChart } from "lucide-react";
import type { LandingStats } from "~/modules/landing/index.server";

export function LandingStatsStrip({ stats }: { stats: LandingStats }) {
  const items = [
    { value: stats.courses, label: "Published courses" },
    { value: stats.lessons, label: "Lessons" },
    { value: stats.instructors, label: "Instructors" },
    { value: stats.categories, label: "Categories" },
  ];

  return (
    <section className="border-y border-border bg-muted/50">
      <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-y-8 px-6 py-10 sm:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="border-l-2 border-primary/20 pl-4">
            <dd className="text-3xl font-bold tracking-tight">{item.value}</dd>
            <dt className="mt-1 text-sm text-muted-foreground">{item.label}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}

const FEATURES = [
  {
    icon: Layers,
    title: "Structured, not scattered",
    body: "Every course is split into modules and short lessons, in the order an instructor would teach them.",
  },
  {
    icon: ClipboardCheck,
    title: "Check yourself as you go",
    body: "Lessons can end in a quiz that tells you what stuck and what to revisit before moving on.",
  },
  {
    icon: LineChart,
    title: "Your progress, remembered",
    body: "Finished lessons are tracked on your dashboard, so a ten-minute session still moves you forward.",
  },
];

export function LandingFeatures() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="max-w-2xl">
        <h2 className="text-3xl font-bold tracking-tight">
          Built for learning that sticks
        </h2>
        <p className="mt-2 text-muted-foreground">
          Everything you need to go from a first lesson to a finished course.
        </p>
      </div>
      <div className="mt-10 grid gap-8 sm:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <div key={title}>
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
              <Icon className="size-5 text-primary" />
            </div>
            <h3 className="mt-4 font-semibold">{title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function LandingFooter({ signedIn }: { signedIn: boolean }) {
  const links = signedIn
    ? [
        { to: "/courses", label: "Courses" },
        { to: "/dashboard", label: "Dashboard" },
      ]
    : [
        { to: "/courses", label: "Courses" },
        { to: "/login", label: "Log In" },
        { to: "/signup", label: "Sign Up" },
      ];

  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-lg font-bold tracking-tight">Cadence</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Learn to code, at your own pace.
          </p>
        </div>
        <nav className="flex flex-wrap gap-6">
          {links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}

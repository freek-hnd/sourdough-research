import { Link, Outlet, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Home, Plus, Wheat, Radio } from "lucide-react";

const NAV = [
  { to: "/", label: "Dashboard", icon: Home },
  { to: "/batch/new", label: "New Batch", icon: Plus },
  { to: "/starters", label: "Starters", icon: Wheat },
  { to: "/stations", label: "Stations", icon: Radio },
];

export function AppShell() {
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="flex h-14 items-center justify-between px-4">
          <Link to="/" className="font-semibold tracking-tight">
            Sourdough Lab
          </Link>
          <Link
            to="/starters"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Starters
          </Link>
        </div>
      </header>
      <main className="flex-1 pb-20">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 backdrop-blur">
        <div className="flex justify-around">
          {NAV.map(({ to, label, icon: Icon }) => {
            const active = pathname === to || (to !== "/" && pathname.startsWith(to));
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-xs",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

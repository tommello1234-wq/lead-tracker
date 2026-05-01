import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { LayoutDashboard, Users, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const navLink = cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-2");

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <header className="border-b bg-card sticky top-0 z-10 backdrop-blur-sm bg-card/80">
        <div className="container mx-auto flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="font-semibold text-base">
              Lead Tracker
            </Link>
            <nav className="flex items-center gap-1">
              <Link href="/dashboard" className={navLink}>
                <LayoutDashboard className="size-4" /> Dashboard
              </Link>
              <Link href="/leads" className={navLink}>
                <Users className="size-4" /> Leads
              </Link>
            </nav>
          </div>
          <form action="/api/auth/logout" method="POST">
            <Button type="submit" variant="ghost" size="sm" className="gap-2">
              <LogOut className="size-4" /> Sair
            </Button>
          </form>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-6">{children}</main>
    </div>
  );
}

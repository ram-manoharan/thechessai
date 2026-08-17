"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { trackPageView } from "@/lib/api";

/** Mounted once in the root layout. Fires on first load and every
 * client-side route change -- skips /admin itself, since the admin's own
 * dashboard usage isn't "site traffic" the dashboard should be counting. */
export function PageViewTracker() {
  const pathname = usePathname();
  const lastTracked = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin") || lastTracked.current === pathname) return;
    lastTracked.current = pathname;
    trackPageView(pathname, document.referrer || undefined);
  }, [pathname]);

  return null;
}

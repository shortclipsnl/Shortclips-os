"use client";

import { useEffect } from "react";
import { markAllPortalNotificationsRead } from "@/server/actions/client-app";

/** Markeert alles als gelezen zodra het meldingencentrum is geopend. */
export function MarkReadOnView() {
  useEffect(() => {
    const t = setTimeout(() => {
      void markAllPortalNotificationsRead().catch(() => undefined);
    }, 1200);
    return () => clearTimeout(t);
  }, []);
  return null;
}

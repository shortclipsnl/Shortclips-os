"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Ververst het kantoorscherm periodiek zodat nieuwe resultaten vanzelf
 *  verschijnen, zonder dat iemand hoeft te klikken. */
export function AutoRefresh({ seconds = 90 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}

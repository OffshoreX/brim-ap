"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { MeResponse } from "@/contracts";
import { Skeleton } from "@/components/ui";
import { call } from "@/components/api";
import { HOME } from "@/components/RoleHome";

// "/" sends each signed-in role to its own landing page, everyone else to the login.
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    call<MeResponse>("/api/me").then((r) => router.replace(r.data ? HOME[r.data.user.role].path : "/login"));
  }, [router]);
  return <main id="main"><Skeleton /></main>;
}

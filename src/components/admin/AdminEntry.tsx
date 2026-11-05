"use client";

import { useSearchParams } from "next/navigation";
import { AdminRoom } from "@/components/admin/AdminRoom";
import { Dashboard } from "@/components/admin/Dashboard";

/** /backstage는 방 목록, /backstage/?room=코드는 그 방의 관리 화면입니다. */
export function AdminEntry() {
  return useSearchParams().get("room") ? <AdminRoom /> : <Dashboard />;
}

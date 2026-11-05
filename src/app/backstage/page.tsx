import { Suspense } from "react";
import { AdminEntry } from "@/components/admin/AdminEntry";

export default function AdminPage() {
  return <Suspense><AdminEntry /></Suspense>;
}

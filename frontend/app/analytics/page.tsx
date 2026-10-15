import { redirect } from "next/navigation";

/** Analytics was replaced by the Progress page. */
export default function AnalyticsPage() {
  redirect("/progress");
}

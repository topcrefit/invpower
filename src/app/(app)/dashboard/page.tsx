import DashboardClient from "./DashboardClient";
import { startOfMonth, ymd } from "@/lib/utils";

export default function DashboardPage() {
  const today = new Date();
  const from = startOfMonth(today);
  return <DashboardClient defaultFrom={ymd(from)} defaultTo={ymd(today)} />;
}

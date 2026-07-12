import { UsageView } from "@/components/UsageView";
import { UsageLogsSection } from "@/components/UsageLogsSection";

// Usage = stats/charts + optional request log (admins only).
export default function UsagePage() {
  return (
    <div className="space-y-7">
      <UsageView />
      <UsageLogsSection />
    </div>
  );
}

import { FlaskConical } from "lucide-react";
import { USE_MOCKS } from "@/lib/api";
export function MockBanner() {
  if (!USE_MOCKS) return null;
  return (
    <div role="status" className="sticky top-0 z-40 flex items-center justify-center gap-2 border-b-2 border-mock-foreground/40 bg-mock px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-mock-foreground">
      <FlaskConical className="h-4 w-4" aria-hidden /> Sample preview data, not real
    </div>
  );
}

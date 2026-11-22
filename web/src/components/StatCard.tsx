import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
export function StatCard({ label, value, status }: { label: string; value: number; status?: string | undefined }) {
  return (
    <Link
      to="/invoices"
      search={status ? { status } : {}}
      className="group glass rounded-xl p-5 hover:border-primary/40"
    >
      <div className="flex items-center justify-between text-sm font-medium text-muted-foreground">
        {label}
        <ArrowUpRight className="h-4 w-4 opacity-50 group-hover:text-primary group-hover:opacity-100" aria-hidden />
      </div>
      <div className="num mt-3 text-4xl font-bold tracking-tight text-foreground">{value.toLocaleString("en-CA")}</div>
    </Link>
  );
}

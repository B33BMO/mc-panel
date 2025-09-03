import { Badge } from "@/components/ui/badge";

export default function StatBadge({
  label,
  value,
}: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-white/60">{label}</span>
      <Badge className="bg-white/10 text-white border-white/20">{value}</Badge>
    </div>
  );
}

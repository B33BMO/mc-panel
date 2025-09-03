"use client";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function ServerTabs({
  servers,
  active,
  onSelect,
}: {
  servers: string[];
  active: string | null;
  onSelect: (n: string) => void;
}) {
  if (!servers.length) return null;

  return (
    <Tabs value={active ?? servers[0]} onValueChange={onSelect}>
      <TabsList
        className="
          flex w-full items-center gap-2 overflow-x-auto rounded-xl
          bg-white/5 p-1 backdrop-blur-xl
        "
      >
        {servers.map((s) => (
          <TabsTrigger
            key={s}
            value={s}
            className="truncate px-3 py-2 text-sm"
            title={s}
          >
            {s}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

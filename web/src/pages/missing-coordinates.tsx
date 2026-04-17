import { useState } from "react";
import { useSearchParams } from "react-router";
import LocationCorrection from "@/components/location-correction.js";
import type { MissingCoordinatesLocation as MissingLocation } from "@/lib/api/types.js";
import { useMissingCoordinates } from "@/lib/hooks/use-geography.js";

export default function MissingCoordinates() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = parseInt(searchParams.get("page") ?? "1");
  const search = searchParams.get("q") ?? "";

  const { data, isLoading: loading } = useMissingCoordinates({ page, search });
  const [correcting, setCorrecting] = useState<MissingLocation | null>(null);

  const setParam = (key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!value) next.delete(key);
      else next.set(key, value);
      if (key !== "page") next.delete("page");
      return next;
    }, { replace: true });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header — compact */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-background px-3 py-2 md:px-4">
        <div>
          <h1 className="font-display text-base font-semibold">
            Помогни с координати
            {data && <span className="ml-2 text-xs font-normal text-muted-foreground">{data.total.toLocaleString()} локации</span>}
          </h1>
          <p className="text-muted-foreground">
            Секции без GPS координати не се показват на картата. Посочете на картата къде се намират — достатъчно е да знаете адреса.
          </p>
        </div>
        <div className="ml-auto">
          <input
            type="text"
            placeholder="Търси..."
            value={search}
            onChange={(e) => setParam("q", e.target.value)}
            className="w-48 rounded border border-border bg-background px-2.5 py-1 text-xs outline-none focus:border-brand sm:w-64"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="min-w-wide-table w-full text-sm">
          <thead className="sticky top-0 z-10 border-b border-border bg-background">
            <tr className="text-2xs uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Населено място</th>
              <th className="w-full px-2 py-2 text-left font-medium">Адрес</th>
              <th className="px-2 py-2 text-right font-medium">Секции</th>
              <th className="px-3 py-2 text-right font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">Зареждане...</td></tr>
            ) : !data?.locations.length ? (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">Няма резултати</td></tr>
            ) : (
              data.locations.map((loc) => {
                const codes = loc.section_codes.split(",");
                return (
                  <tr key={loc.id} className="border-b border-border/50 transition-colors hover:bg-muted/30">
                    <td className="whitespace-nowrap px-3 py-1.5 font-medium">{loc.settlement_name}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{loc.address}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      <span className="font-mono text-2xs" title={codes.join(", ")}>
                        {loc.section_count}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right">
                      <button
                        onClick={() => setCorrecting(loc)}
                        className="rounded border border-brand px-2 py-0.5 text-xs font-medium text-score-high transition-colors hover:bg-brand hover:text-white"
                      >
                        Посочи
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-3 py-1.5">
          <button
            onClick={() => setParam("page", String(Math.max(1, page - 1)))}
            disabled={page <= 1}
            className="text-muted-foreground disabled:opacity-30"
          >
            &larr; Назад
          </button>
          <span className="text-muted-foreground">
            Стр. {page} от {data.pages}
          </span>
          <button
            onClick={() => setParam("page", String(Math.min(data.pages, page + 1)))}
            disabled={page >= data.pages}
            className="text-muted-foreground disabled:opacity-30"
          >
            Напред &rarr;
          </button>
        </div>
      )}

      {/* Location correction modal */}
      {correcting && (
        <LocationCorrection
          sectionCode={correcting.section_codes.split(",")[0]}
          electionId="1"
          settlementName={correcting.settlement_name}
          address={correcting.address}
          currentLat={null}
          currentLng={null}
          onClose={() => setCorrecting(null)}
        />
      )}
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import { api, type Nonprofit } from "@/lib/api";

/** Searchable list of the verified nonprofits this site supports. */
export function NonprofitPicker({ value, current, onChange, label = "Search nonprofits" }: { value: string | null; current?: string | null; onChange: (id: string) => void; label?: string }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<Nonprofit[] | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      api<{ charities: Nonprofit[] }>(`/api/charities?q=${encodeURIComponent(q)}`).then((r) => setList(r.charities), () => setList([]));
    }, 180);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={label} aria-label={label} autoComplete="off" />
      <div className="picker" role="listbox" aria-label="Nonprofits">
        {list === null && <p className="muted small">Loading nonprofits…</p>}
        {list?.length === 0 && <p className="muted small">{q ? "No nonprofit matches that." : "No nonprofits have been added yet."}</p>}
        {list?.map((n) => (
          <button type="button" key={n.config_id} aria-pressed={n.config_id === value} onClick={() => onChange(n.config_id)}>
            <span>
              {n.name}
              {n.config_id === current ? <small> (current)</small> : null}
            </span>
            {n.x_handle ? <small>@{n.x_handle}</small> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

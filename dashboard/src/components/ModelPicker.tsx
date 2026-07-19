"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { CapacityBadges } from "@/components/CapacityBadges";

export interface ModelGroup {
  label: string;
  items: { value: string; label: string; tag?: string }[];
}

/**
 * aigloo-style model picker: a search box + provider-grouped chips you click to
 * toggle in/out of a selection. Used by the combo form and the CLI-tool model
 * selection so both add models the same way (click to add, click again to drop).
 */
export function ModelPicker({
  title = "Add models",
  note = "Click to add, click again to remove.",
  searchPlaceholder = "Search models…",
  groups,
  selected,
  onToggle,
  onClose,
  showThinkingHint = false,
  singleSelect = false,
}: {
  title?: string;
  note?: string;
  searchPlaceholder?: string;
  groups: ModelGroup[];
  selected: string[];
  onToggle: (value: string) => void;
  onClose: () => void;
  /** The "reasoning models accept a thinking suffix" footer only makes sense when
   *  picking MODELS. Provider/key pickers reuse this component, so they hide it. */
  showThinkingHint?: boolean;
  /** Single-select mode: hides Select all / Done / count — picker closes on
   *  first click (budget scope picker uses this). */
  singleSelect?: boolean;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = groups
    .map((g) => ({
      ...g,
      items: needle ? g.items.filter((i) => i.value.toLowerCase().includes(needle)) : g.items,
    }))
    .filter((g) => g.items.length > 0);
  const sel = new Set(selected);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-6 sm:p-10" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-brand-lg glass-strong modal-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <h2 className="text-[14px] font-semibold text-text">{title}</h2>
          <button onClick={onClose} className="text-text-subtle hover:text-text" aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="border-b border-border-subtle px-4 py-3">
          <p className="mb-2 text-[12px] text-text-muted">{note}</p>
          <div className="relative">
            <Icon name="search" size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-subtle" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full rounded-brand border border-border bg-bg py-2 pl-8 pr-3 text-[13px] text-text placeholder:text-text-subtle focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-text-subtle">No models match "{q}".</p>
          ) : (
            <div className="space-y-4">
              {filtered.map((g) => {
                const allOn = g.items.length > 0 && g.items.every((it) => sel.has(it.value));
                const someOn = g.items.some((it) => sel.has(it.value));
                return (
                  <div key={g.label}>
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
                        {g.label} <span className="tnum text-text-subtle">({g.items.length})</span>
                      </span>
                      {!singleSelect && (
                        <button
                          type="button"
                          onClick={() => g.items.forEach((it) => {
                            if (allOn) onToggle(it.value);
                            else if (!sel.has(it.value)) onToggle(it.value);
                          })}
                          className="text-[11px] font-medium text-text-muted transition-colors hover:text-accent"
                        >
                          {allOn ? "Deselect all" : someOn ? "Select rest" : "Select all"}
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {g.items.map((it) => {
                        const on = sel.has(it.value);
                        return (
                          <button
                            key={it.value}
                            type="button"
                            onClick={() => onToggle(it.value)}
                            className={`inline-flex items-center gap-1 rounded-brand border px-2 py-1 text-[12px] transition-colors ${
                              on ? "border-accent bg-accent-soft text-accent" : "border-border bg-bg text-text-muted hover:border-text-subtle hover:text-text"
                            }`}
                          >
                            {on && <Icon name="check" size={12} />}
                            <span className="tnum">{it.label}</span>
                            <CapacityBadges model={it.value} size={13} />
                            {it.tag && <span className="rounded bg-surface-2 px-1 text-[11px] text-text-subtle">{it.tag}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {showThinkingHint && null}

        {!singleSelect && (
          <div className="flex items-center justify-between border-t border-border-subtle px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="tnum text-[12px] text-text-subtle">{selected.length} selected</span>
              {filtered.flatMap((g) => g.items).length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const all = filtered.flatMap((g) => g.items.map((it) => it.value));
                    const allOn = all.every((v) => sel.has(v));
                    all.forEach((v) => {
                      if (allOn && sel.has(v)) onToggle(v);
                      else if (!allOn && !sel.has(v)) onToggle(v);
                    });
                  }}
                  className="text-[12px] font-medium text-text-muted transition-colors hover:text-accent"
                >
                  {filtered.flatMap((g) => g.items).every((it) => sel.has(it.value)) ? "Clear all" : "Select all"}
                </button>
              )}
            </div>
            <button onClick={onClose} className="rounded-brand bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-accent-ink hover:bg-accent-hover">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { CapacityBadges } from "@/components/CapacityBadges";
import { useCapsTables } from "@/lib/useCaps";
import {
  levelsForModel,
  selectedModelVariant,
  thinkingLevelOf,
  withThinkingLevel,
  type ThinkingLevel,
} from "@/lib/capabilities";

export interface ModelGroup {
  label: string;
  items: { value: string; label: string; tag?: string }[];
}

/**
 * aigloo-style model picker: a search box + provider-grouped chips you click to
 * toggle in/out of a selection. Used by the combo form and the CLI-tool model
 * selection so both add models the same way (click to add, click again to drop).
 *
 * With `thinkingLevels` enabled, each selected reasoning model shows an inline
 * level `<select>` so the user can emit `provider/model(level)` instead of the
 * bare `provider/model`. `none` is an explicit disable; the empty option is the
 * model's default (no suffix). `max` is only offered for `*gpt-5.6-sol*`.
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
  thinkingLevels = false,
  onReplace,
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
  /** Opt-in: show a per-chip thinking-level `<select>` for selected reasoning
   *  models. Emits `provider/model(level)` via `onReplace` (or two `onToggle`
   *  calls as a fallback). When combined with `singleSelect`, the picker no
   *  longer auto-closes on first click — a Done button appears so the user can
   *  pick a level before confirming. */
  thinkingLevels?: boolean;
  /** Atomic replace of one selected value with another (level change). Used
   *  only when `thinkingLevels` is true. Falls back to `onToggle(old)` then
   *  `onToggle(new)` when omitted — fine for multi-select, but single-select
   *  callers should provide this so the picker doesn't close mid-change. */
  onReplace?: (oldValue: string, newValue: string) => void;
}) {
  const [q, setQ] = useState("");
  const capsTables = useCapsTables();
  const needle = q.trim().toLowerCase();
  const filtered = groups
    .map((g) => ({
      ...g,
      items: needle ? g.items.filter((i) => i.value.toLowerCase().includes(needle)) : g.items,
    }))
    .filter((g) => g.items.length > 0);
  function variantOf(base: string): string | null {
    return thinkingLevels ? selectedModelVariant(base, selected) : (selected.includes(base) ? base : null);
  }

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
                const variants = g.items.map((it) => variantOf(it.value));
                const allOn = g.items.length > 0 && variants.every((v) => v !== null);
                const someOn = variants.some((v) => v !== null);
                return (
                  <div key={g.label}>
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
                        {g.label} <span className="tnum text-text-subtle">({g.items.length})</span>
                      </span>
                      {!singleSelect && (
                        <button
                          type="button"
                          onClick={() => g.items.forEach((it, i) => {
                            const v = variants[i];
                            if (allOn && v) onToggle(v);
                            else if (!allOn && !v) onToggle(it.value);
                          })}
                          className="text-[11px] font-medium text-text-muted transition-colors hover:text-accent"
                        >
                          {allOn ? "Deselect all" : someOn ? "Select rest" : "Select all"}
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {g.items.map((it, i) => {
                        const variant = variants[i];
                        const on = variant !== null;
                        const levels: readonly ThinkingLevel[] =
                          thinkingLevels && capsTables ? levelsForModel(it.value, capsTables) : [];
                        const showLevel = thinkingLevels && on && levels.length > 0;
                        const currentLevel = variant ? thinkingLevelOf(variant) : "";
                        return (
                          <span key={it.value} className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => onToggle(variant ?? it.value)}
                              className={`inline-flex items-center gap-1 rounded-brand border px-2 py-1 text-[12px] transition-colors ${
                                on ? "border-accent bg-accent-soft text-accent" : "border-border bg-bg text-text-muted hover:border-text-subtle hover:text-text"
                              }`}
                            >
                              {on && <Icon name="check" size={12} />}
                              <span className="tnum">{it.label}</span>
                              <CapacityBadges model={it.value} size={13} />
                              {it.tag && <span className="rounded bg-surface-2 px-1 text-[11px] text-text-subtle">{it.tag}</span>}
                            </button>
                            {showLevel && (
                              <select
                                aria-label={`Thinking level for ${it.label}`}
                                value={currentLevel}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  const level = e.target.value;
                                  const newV = withThinkingLevel(it.value, level);
                                  const oldV = variant ?? it.value;
                                  if (oldV === newV) return;
                                  if (onReplace) onReplace(oldV, newV);
                                  else { onToggle(oldV); onToggle(newV); }
                                }}
                                className="rounded-brand border border-border bg-bg px-1.5 py-1 text-[11px] text-text focus:border-accent focus:outline-none"
                              >
                                <option value="">default</option>
                                {levels.map((l) => (
                                  <option key={l} value={l}>{l}</option>
                                ))}
                              </select>
                            )}
                          </span>
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

        {(!singleSelect || thinkingLevels) && (
          <div className="flex items-center justify-between border-t border-border-subtle px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="tnum text-[12px] text-text-subtle">{selected.length} selected</span>
              {filtered.flatMap((g) => g.items).length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const all = filtered.flatMap((g) => g.items.map((it) => it.value));
                    const allVariants = all.map((v) => variantOf(v));
                    const allOn = allVariants.every((v) => v !== null);
                    all.forEach((v, i) => {
                      const variant = allVariants[i];
                      if (allOn && variant) onToggle(variant);
                      else if (!allOn && !variant) onToggle(v);
                    });
                  }}
                  className="text-[12px] font-medium text-text-muted transition-colors hover:text-accent"
                >
                  {filtered.flatMap((g) => g.items).every((it) => variantOf(it.value) !== null) ? "Clear all" : "Select all"}
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

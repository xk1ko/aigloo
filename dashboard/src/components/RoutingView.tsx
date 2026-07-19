"use client";

import { useEffect, useState, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { adminApi } from "@/lib/client";
import { Badge } from "@/components/Badge";
import { Button, Input, Select, Field } from "@/components/Button";
import { ModelPicker, type ModelGroup } from "@/components/ModelPicker";
import { Icon } from "@/components/Icon";
import { ConfirmModal } from "@/components/ConfirmModal";
import { fmt, Empty, LoadingDots } from "@/components/ui";
import type { MaskedConfig, MaskedRoute, ProviderSnapshot } from "@/lib/gateway";

function modelFor(route: MaskedRoute, i: number): string {
  if (Array.isArray(route.model)) return route.model[i] ?? route.model[0] ?? route.alias;
  if (typeof route.model === "string") return route.model;
  return route.alias;
}

const COLLAPSE_AT = 6;

export function RoutingView() {
  const [config, setConfig] = useState<MaskedConfig | null>(null);
  const [health, setHealth] = useState<ProviderSnapshot[]>([]);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState("");
  const [chainTest, setChainTest] = useState<Record<string, Record<number, "testing" | "ok" | "fail">>>({});
  const [chainBusy, setChainBusy] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [editing, setEditing] = useState<MaskedRoute | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  const reload = useCallback(async () => {
    const [cfgRes, prov] = await Promise.all([fetch("/api/gw/admin/config"), adminApi.providers()]);
    if (!cfgRes.ok) {
      setError("could not reach the gateway");
      return;
    }
    setError("");
    setConfig((await cfgRes.json()) as MaskedConfig);
    setHealth(prov.data?.providers ?? []);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (error) return <Empty>{error}</Empty>;
  if (!config) return <LoadingDots />;

  const healthy = (pid: string) => {
    const h = health.find((x) => x.id === pid);
    return h ? h.keys.some((k) => k.healthy) : true;
  };

  async function del(alias: string) {
    setBusy(alias);
    const r = await adminApi.removeRoute(alias);
    setBusy("");
    if (!r.ok) setError(r.error ?? "failed");
    else await reload();
  }

  async function testChain(route: MaskedRoute) {
    setChainBusy(route.alias);
    setChainTest((prev) => ({ ...prev, [route.alias]: {} }));
    for (let i = 0; i < route.target.length; i++) {
      setChainTest((prev) => ({ ...prev, [route.alias]: { ...prev[route.alias], [i]: "testing" } }));
      const r = await adminApi.testProvider(route.target[i]!);
      const ok = r.ok && r.data?.ok;
      setChainTest((prev) => ({ ...prev, [route.alias]: { ...prev[route.alias], [i]: ok ? "ok" : "fail" } }));
      if (i < route.target.length - 1) await new Promise((resolve) => setTimeout(resolve, 400));
    }
    setChainBusy(null);
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight heading-gradient heading-accent">Combos</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowInfo((v) => !v)} className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-2 hover:text-text" aria-label="Strategy info">
            <Icon name="info" size={18} />
          </button>
          <Button onClick={() => setAdding((v) => !v)}>
            <Icon name={adding ? "close" : "add"} size={17} />
            {adding ? "Cancel" : "Add combo"}
          </Button>
        </div>
      </div>

      {showInfo && (
        <div className="mb-5 rounded-brand-lg card p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-[13px] font-semibold text-text">Fallback</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-text-muted">
                Always starts from #1 in the chain. If it fails (quota, rate-limit, error), moves to #2, then #3, until one succeeds. Every new request starts from #1 again.
              </p>
              <p className="mt-1.5 text-[11.5px] text-text-subtle">Best when you have a preferred primary provider and others as backup.</p>
            </div>
            <div>
              <h3 className="text-[13px] font-semibold text-text">Round-robin</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-text-muted">
                Rotates the starting provider each request to spread load. With sticky, N consecutive requests go to the same provider before rotating. If a provider fails, falls back to the next in chain.
              </p>
              <p className="mt-1.5 text-[11.5px] text-text-subtle">Best when all providers are equal and you want to distribute traffic.</p>
            </div>
          </div>
        </div>
      )}

      {adding && (
        <RouteForm
          providers={config.providers.filter((p) => !p.disabled)}
          onDone={() => { setAdding(false); void reload(); }}
        />
      )}

      {editing && !adding && (
        <RouteForm
          providers={config.providers.filter((p) => !p.disabled)}
          initial={editing}
          onDone={() => { setEditing(null); void reload(); }}
          onCancel={() => setEditing(null)}
        />
      )}

      {/* section header */}
      <div className="mb-2 flex items-center gap-2">
        <Icon name="alt_route" size={16} className="text-text-subtle" />
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-text-subtle">Combos</h2>
        <span className="text-[11px] text-text-muted">{config.models.length} total</span>
        <div className="ml-2 h-px flex-1 bg-border-subtle" />
      </div>

      {config.models.length === 0 ? (
        <Empty>No combos yet. Add one to expose a model alias to your CLI tools.</Empty>
      ) : (
        <div className="space-y-2.5">
          {config.models.map((route) => {
            const ct = chainTest[route.alias];
            return (
              <RouteCard
                key={route.alias}
                route={route}
                healthy={healthy}
                chainTest={ct}
                chainBusy={chainBusy}
                onTest={() => testChain(route)}
                onEdit={() => { setEditing(route); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                onDelete={() => setPendingDelete(route.alias)}
                deleteBusy={busy === route.alias}
              />
            );
          })}
        </div>
      )}

      {pendingDelete && (
        <ConfirmModal
          title="Remove combo"
          message={`Delete "${pendingDelete}"? CLI tools using this alias will stop working.`}
          confirmLabel="Remove"
          busy={busy === pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            void del(pendingDelete).then(() => setPendingDelete(null));
          }}
        />
      )}
    </div>
  );
}

function RouteCard({
  route,
  healthy,
  chainTest,
  chainBusy,
  onTest,
  onEdit,
  onDelete,
  deleteBusy,
}: {
  route: MaskedRoute;
  healthy: (pid: string) => boolean;
  chainTest?: Record<number, "testing" | "ok" | "fail">;
  chainBusy: string | null;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
  deleteBusy: boolean;
}) {
  const isTesting = chainBusy === route.alias;
  const total = route.target.length;
  const [expanded, setExpanded] = useState(false);
  const show = expanded || total <= COLLAPSE_AT ? total : COLLAPSE_AT;

  return (
    <div className="card overflow-hidden rounded-brand-lg">
      {/* row 1 — identity + actions */}
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-5 py-3">
        <div className="flex items-center gap-3">
          <code className="truncate text-[16px] font-bold text-text">{route.alias}</code>
          <Badge tone={route.strategy === "round-robin" ? "info" : "neutral"}>{route.strategy}</Badge>
          <div className="flex items-center gap-2 text-[11px] text-text-subtle">
            {route.sticky && route.sticky > 1 && <span>sticky {route.sticky}</span>}
            {(route.price_in !== undefined || route.price_out !== undefined) && (
              <span className="tnum">{fmt.cost(route.price_in ?? 0)}/{fmt.cost(route.price_out ?? 0)}/1M</span>
            )}
            <span>{total} in chain</span>
          </div>
        </div>
        <div className="flex flex-none items-center gap-1">
          <button
            onClick={onTest}
            disabled={isTesting}
            className="inline-flex items-center gap-1 rounded-brand border border-border bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-text-muted transition-colors hover:bg-surface-3 hover:text-text disabled:opacity-60"
            title="Test each provider in this chain"
          >
            <Icon name={isTesting ? "progress_activity" : "sync"} size={13} className={isTesting ? "animate-spin" : ""} />
            Test
          </button>
          <button onClick={onEdit} className="flex h-7 w-7 items-center justify-center rounded-brand text-text-muted transition-colors hover:bg-surface-2 hover:text-text" aria-label="Edit combo">
            <Icon name="edit" size={15} />
          </button>
          <button onClick={onDelete} disabled={deleteBusy} className="flex h-7 w-7 items-center justify-center rounded-brand text-text-muted transition-colors hover:bg-danger/10 hover:text-danger" aria-label="Remove alias">
            <Icon name="delete" size={15} />
          </button>
        </div>
      </div>

      {/* row 2 — vertical timeline */}
      <div className="px-5 py-4">
        <div className="relative">
          {route.target.slice(0, show).map((pid, i) => {
            const ct = chainTest?.[i];
            const isHealthy = healthy(pid);
            const isLast = i === show - 1;

            const dotColor = ct === "ok" ? "var(--color-success)"
              : ct === "fail" ? "var(--color-danger)"
              : ct === "testing" ? "var(--color-accent)"
              : isHealthy ? "var(--color-success)"
              : "var(--color-danger)";

            const circleBorder = ct === "ok" ? "border-success/50 bg-success/5"
              : ct === "fail" ? "border-danger/50 bg-danger/5"
              : ct === "testing" ? "border-accent/50 bg-accent/5"
              : "border-border-subtle bg-surface-2";

            return (
              <div key={pid + i} className="relative flex items-center gap-3 pb-3 last:pb-0">
                {!isLast && (
                  <div className="absolute left-[13px] top-7 bottom-0 w-px bg-border-subtle" />
                )}
                <div className={`relative z-10 flex h-7 w-7 flex-none items-center justify-center rounded-full border ${circleBorder} ${ct === "testing" ? "animate-pulse" : ""}`}>
                  {ct === "ok" ? (
                    <Icon name="check" size={14} className="text-success" />
                  ) : ct === "fail" ? (
                    <Icon name="close" size={14} className="text-danger" />
                  ) : ct === "testing" ? (
                    <Icon name="progress_activity" size={13} className="animate-spin text-accent" />
                  ) : (
                    <span className="tnum text-[11px] font-medium text-text-muted">{i + 1}</span>
                  )}
                </div>
                <div className="flex flex-1 items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-text">{pid}</span>
                    <span className="tnum text-[11px] text-text-subtle">{modelFor(route, i)}</span>
                  </div>
                  <span className="h-2 w-2 flex-none rounded-full" style={{ background: dotColor, boxShadow: `0 0 5px ${dotColor}` }} />
                </div>
              </div>
            );
          })}
          {total > COLLAPSE_AT && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 w-full rounded-brand py-1.5 text-[12px] font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
            >
              {expanded ? "Show less" : `Show all ${total}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type ProviderOption = { id: string; models: { id: string }[] };

function RouteForm({ providers, onDone, initial, onCancel }: { providers: ProviderOption[]; onDone: () => void; initial?: MaskedRoute; onCancel?: () => void }) {
  const isEdit = !!initial;
  const [alias, setAlias] = useState(initial?.alias ?? "");
  const [entries, setEntries] = useState<string[]>(() => {
    if (!initial) return [];
    return initial.target.map((pid, i) => {
      const m = Array.isArray(initial.model) ? initial.model[i] ?? initial.model[0] : initial.model ?? initial.alias;
      return `${pid}/${m}`;
    });
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [strategy, setStrategy] = useState<"fallback" | "round-robin">(initial?.strategy ?? "fallback");
  const [sticky, setSticky] = useState(initial?.sticky ?? 1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const groups: ModelGroup[] = providers
    .filter((p) => p.models.length > 0)
    .map((p) => ({ label: p.id, items: p.models.map((m) => ({ value: `${p.id}/${m.id}`, label: `${p.id}/${m.id}` })) }));

  function toggle(v: string) {
    setErr("");
    setEntries((e) => (e.includes(v) ? e.filter((x) => x !== v) : [...e, v]));
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setEntries((items) => {
      const oldI = items.indexOf(String(active.id));
      const newI = items.indexOf(String(over.id));
      return arrayMove(items, oldI, newI);
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!alias || entries.length === 0) {
      setErr("a name and at least one model are required");
      return;
    }
    setBusy(true);
    setErr("");
    const target = entries.map((x) => x.slice(0, x.indexOf("/")));
    const model = entries.map((x) => x.slice(x.indexOf("/") + 1));
    const r = await adminApi.setRoute(alias, {
      target,
      model,
      strategy,
      sticky: strategy === "round-robin" ? sticky : undefined,
    });
    if (r.ok && isEdit && initial!.alias !== alias) {
      await adminApi.removeRoute(initial!.alias);
    }
    setBusy(false);
    if (r.ok) onDone();
    else setErr(r.error ?? "failed");
  }

  return (
    <form onSubmit={submit} className="mb-5 rounded-brand-lg card p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Alias" hint="the name your CLI requests as a model">
          <Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="my-combo" />
        </Field>
        <Field label="Strategy" hint="how the chain is tried">
          <Select value={strategy} onChange={(e) => setStrategy(e.target.value as "fallback" | "round-robin")}>
            <option value="fallback">Fallback — try in order, next on failure</option>
            <option value="round-robin">Round Robin — rotate to spread load</option>
          </Select>
        </Field>
      </div>

      {strategy === "round-robin" && (
        <Field label="Sticky" hint="requests per model before rotating">
          <div className="flex items-center gap-2">
            <button type="button" disabled={sticky <= 1} onClick={() => setSticky((s) => Math.max(1, s - 1))} className="flex h-9 w-9 items-center justify-center rounded-brand border border-border bg-bg text-text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-40" aria-label="Decrease sticky">
              <Icon name="remove" size={16} />
            </button>
            <span className="tnum w-10 text-center text-[14px] font-medium text-text">{sticky}</span>
            <button type="button" onClick={() => setSticky((s) => s + 1)} className="flex h-9 w-9 items-center justify-center rounded-brand border border-border bg-bg text-text-muted transition-colors hover:bg-surface-2 hover:text-text" aria-label="Increase sticky">
              <Icon name="add" size={16} />
            </button>
          </div>
        </Field>
      )}

      <div className="mt-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-text-subtle">
            Models — fallback order (drag to reorder)
          </span>
          <Button type="button" variant="ghost" onClick={() => setPickerOpen(true)}>
            <Icon name="add" size={16} /> Add models
          </Button>
        </div>

        {entries.length === 0 ? (
          <div className="mt-2 rounded-brand border border-dashed border-border-subtle px-3 py-4 text-center text-[12px] text-text-subtle">
            No models yet. Click <span className="text-text-muted">Add models</span> and pick from your providers.
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={entries} strategy={verticalListSortingStrategy}>
              <ul className="mt-2 max-h-[280px] space-y-1.5 overflow-y-auto">
                {entries.map((entry, i) => (
                  <SortableEntry key={entry} entry={entry} index={i} onRemove={() => setEntries((e) => e.filter((_, idx) => idx !== i))} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {err && <div className="mt-2 text-[12px] text-danger">{err}</div>}
      <div className="mt-3 flex justify-end gap-2">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : isEdit ? "Update combo" : "Save combo"}</Button>
      </div>

      {pickerOpen && (
        <ModelPicker
          title="Add models to the chain"
          note="Click a model to add it, click again to remove. Drag to reorder after."
          groups={groups}
          selected={entries}
          onToggle={toggle}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </form>
  );
}

function SortableEntry({ entry, index, onRemove }: { entry: string; index: number; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry });
  const style = {
    transform: `translate3d(0, ${transform?.y ?? 0}px, 0)`,
    transition,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`flex cursor-grab items-center gap-2.5 rounded-brand border px-3 py-2 active:cursor-grabbing ${
        isDragging ? "border-accent bg-accent-soft opacity-80 shadow-elevated z-10" : "border-border-subtle"
      }`}
    >
      <Icon name="drag_indicator" size={16} className="flex-none text-text-subtle" />
      <span className="tnum text-[11px] text-text-subtle">#{index + 1}</span>
      <span className="tnum truncate text-[13px] text-text">{entry}</span>
      <button
        type="button"
        onClick={onRemove}
        onPointerDown={(e) => e.stopPropagation()}
        className="ml-auto flex-none text-text-subtle hover:text-danger"
        aria-label={`Remove ${entry}`}
      >
        <Icon name="close" size={14} />
      </button>
    </li>
  );
}

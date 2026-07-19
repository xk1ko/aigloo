"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RichCard, CardTitle } from "@/components/RichCard";
import { Badge } from "@/components/Badge";
import { Button, Select } from "@/components/Button";
import { ModelPicker, type ModelGroup } from "@/components/ModelPicker";
import { Icon } from "@/components/Icon";
import { Empty, LoadingDots } from "@/components/ui";
import { adminApi, cliConfig, type CliStatus } from "@/lib/client";
import { toolById } from "@/lib/cliTools";
import { modalitiesForModel } from "@/lib/capabilities";
import { useCapsTables } from "@/lib/useCaps";
import type { EndpointPayload, MaskedConfig } from "@/lib/gateway";

/** Step-by-step setup for one CLI tool, with copy-ready env (real key inlined). */
export function ToolDetail({ id }: { id: string }) {
  const router = useRouter();
  const tool = toolById(id);
  const capsTables = useCapsTables();
  const [ep, setEp] = useState<EndpointPayload | null>(null);
  const [combos, setCombos] = useState<string[]>([]);
  const [comboModels, setComboModels] = useState<Record<string, string[]>>({});
  const [keyIdx, setKeyIdx] = useState(0);
  const [realKey, setRealKey] = useState("");
  const [savedBases, setSavedBases] = useState<string[]>([]);
  const [selectedBase, setSelectedBase] = useState(""); // "" = auto-detected
  const [customBaseInput, setCustomBaseInput] = useState("");
  const [showCustomBase, setShowCustomBase] = useState(false);
  const [customKey, setCustomKey] = useState("");
  const [showCustomKey, setShowCustomKey] = useState(false);
  const [customKeyInput, setCustomKeyInput] = useState("");

  useEffect(() => {
    const bases = JSON.parse(localStorage.getItem(`cli-saved-bases-${id}`) ?? "[]") as string[];
    setSavedBases(bases);
    const sel = localStorage.getItem(`cli-selected-base-${id}`) ?? "";
    setSelectedBase(sel);
    const key = localStorage.getItem(`cli-custom-key-${id}`) ?? "";
    setCustomKey(key);
  }, [id]);
  const [error, setError] = useState("");
  const [cli, setCli] = useState<CliStatus | null>(null);
  const [cliBusy, setCliBusy] = useState<"" | "apply" | "reset">("");
  const [cliMsg, setCliMsg] = useState("");
  const [allModels, setAllModels] = useState<string[]>([]);
  const [groups, setGroups] = useState<ModelGroup[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSlot, setPickerSlot] = useState<"opus" | "sonnet" | "haiku" | null>(null); // which slot the picker targets
  const [picked, setPicked] = useState<string[]>([]); // openai tools: chosen models
  const [active, setActive] = useState(""); // openai tools: default/active model
  const [slots, setSlots] = useState({ opus: "", sonnet: "", haiku: "" }); // claude
  const [isMember, setIsMember] = useState(false);
  const [memberName, setMemberName] = useState("");
  const isAnthropic = tool?.format === "anthropic";

  function togglePicked(v: string) {
    if (picked.includes(v)) {
      setPicked((p) => p.filter((x) => x !== v));
      if (active === v) setActive("");
    } else {
      setPicked((p) => [...p, v]);
      if (!active) setActive(v);
    }
  }

  const loadCli = useCallback(async () => {
    if (!tool?.autoConfig) return;
    const r = await cliConfig.status(tool.id);
    setCli(r.data);
  }, [tool]);
  useEffect(() => { void loadCli(); }, [loadCli]);

  // seed the editable selection from whatever is already in the tool's config.
  useEffect(() => {
    if (!cli?.installed) return;
    if (isAnthropic && cli.modelSlots) {
      setSlots({ opus: cli.modelSlots.opus ?? "", sonnet: cli.modelSlots.sonnet ?? "", haiku: cli.modelSlots.haiku ?? "" });
    } else if (!isAnthropic && cli.models && cli.models.length > 0) {
      setPicked(cli.models);
      setActive(cli.activeModel ?? cli.models[0] ?? "");
    }
  }, [cli, isAnthropic]);

  function addCustomBase(url: string) {
    const trimmed = url.trim();
    if (!trimmed) return;
    const next = [trimmed, ...savedBases.filter((b) => b !== trimmed)];
    setSavedBases(next);
    setSelectedBase(trimmed);
    localStorage.setItem(`cli-saved-bases-${id}`, JSON.stringify(next));
    localStorage.setItem(`cli-selected-base-${id}`, trimmed);
    setCustomBaseInput("");
    setShowCustomBase(false);
  }

  async function applyCli() {
    if (!tool || !ep) return;
    setCliMsg("");
    localStorage.setItem(`cli-selected-base-${id}`, selectedBase);
    if (customKey.trim()) localStorage.setItem(`cli-custom-key-${id}`, customKey.trim());
    else localStorage.removeItem(`cli-custom-key-${id}`);
    const autoBase = `http://127.0.0.1:${ep.port}`;
    const baseUrl = selectedBase || autoBase;
    const key = customKey.trim() || (ep.keys.length ? realKey || undefined : undefined);
    if (isAnthropic) {
      const m: Record<string, string> = {};
      if (slots.opus) m.opus = slots.opus;
      if (slots.sonnet) m.sonnet = slots.sonnet;
      if (slots.haiku) m.haiku = slots.haiku;
      setCliBusy("apply");
      const r = await cliConfig.apply(tool.id, { base: baseUrl, key, models: m });
      setCliBusy("");
      setCliMsg(r.ok ? "Wrote config ✓" : r.error ?? "failed");
      if (r.ok) void loadCli();
      return;
    }
    if (picked.length === 0) { setCliMsg("add at least one model"); return; }
    setCliBusy("apply");
    const modalities = Object.fromEntries(picked.map((m) => [m, modalitiesFor(m)]));
    const r = await cliConfig.apply(tool.id, { base: baseUrl, key, models: picked, active, modalities });
    setCliBusy("");
    setCliMsg(r.ok ? "Wrote config ✓" : r.error ?? "failed");
    if (r.ok) void loadCli();
  }

  async function resetCli() {
    if (!tool) return;
    setCliBusy("reset");
    setCliMsg("");
    const r = await cliConfig.reset(tool.id);
    setCliBusy("");
    if (r.ok) { setCliMsg("Removed gateway config ✓"); setPicked([]); setActive(""); setSlots({ opus: "", sonnet: "", haiku: "" }); void loadCli(); }
    else setCliMsg(r.error ?? "failed");
  }

  useEffect(() => {
    void (async () => {
      const meRes = await fetch("/api/me", { credentials: "same-origin" });
      const me = meRes.ok ? ((await meRes.json()) as {
        role?: string;
        name?: string;
        port?: number;
        catalog?: string[];
        catalog_groups?: ModelGroup[];
      }) : null;

      if (me?.role === "member") {
        setIsMember(true);
        setMemberName(me.name ?? "Access key");
        const port = me.port ?? 18080;
        setEp({
          port,
          keys: [{ key: "••••", name: me.name ?? "Your key", fingerprint: "" }],
          rtk: false,
          caveman: "off",
          ponytail: "off",
          headroom: { enabled: false, url: "", compress_user_messages: false },
        });
        const catalog = me.catalog ?? [];
        setAllModels(catalog);
        setGroups(me.catalog_groups ?? (catalog.length ? [{ label: "Allowed", items: catalog.map((a) => ({ value: a, label: a })) }] : []));
        setCombos([]);
        // Prefer key from this browser's login; server injects on Apply if missing.
        try {
          const stored = sessionStorage.getItem("aigloo_member_key") ?? "";
          if (stored) {
            setCustomKey(stored);
            setRealKey(stored);
          }
        } catch {
          /* ignore */
        }
        // Pre-pick models for auto-config: first 3 into slots / all for openai list
        if (catalog.length) {
          if (tool?.format === "anthropic") {
            setSlots({
              opus: catalog[0] ?? "",
              sonnet: catalog[1] ?? catalog[0] ?? "",
              haiku: catalog[2] ?? catalog[0] ?? "",
            });
          } else {
            setPicked(catalog.slice(0, 8));
            setActive(catalog[0] ?? "");
          }
        }
        return;
      }

      const [epRes, cfgRes] = await Promise.all([
        fetch("/api/gw/admin/endpoint"),
        fetch("/api/gw/admin/config"),
      ]);
      if (!epRes.ok) {
        setError("could not reach the gateway");
        return;
      }
      setEp((await epRes.json()) as EndpointPayload);
      if (cfgRes.ok) {
        const cfg = (await cfgRes.json()) as MaskedConfig;
        const aliases = cfg.models.map((m) => m.alias);
        setCombos(aliases);
        const cm: Record<string, string[]> = {};
        for (const m of cfg.models) {
          const providers = m.target ?? [];
          const models = Array.isArray(m.model) ? m.model : m.model ? [m.model] : [m.alias];
          const refs: string[] = [];
          for (let i = 0; i < providers.length; i++) {
            const model = models[i] ?? models[0] ?? m.alias;
            refs.push(`${providers[i]}/${model}`);
          }
          if (refs.length) cm[m.alias] = refs;
        }
        setComboModels(cm);
        // disabled providers are skipped in routing, so hide their models here.
        const liveProviders = cfg.providers.filter((p) => !p.disabled);
        // everything callable: combo aliases + every (enabled) provider/model ref.
        const refs = liveProviders.flatMap((p) => p.models.map((m) => `${p.id}/${m.id}`));
        setAllModels([...aliases, ...refs]);
        // grouped for the picker: Combos first, then one group per provider.
        const grps: ModelGroup[] = [];
        if (aliases.length) grps.push({ label: "Combos", items: aliases.map((a) => ({ value: a, label: a })) });
        for (const p of liveProviders) {
          if (p.models.length) grps.push({ label: p.id, items: p.models.map((m) => ({ value: `${p.id}/${m.id}`, label: `${p.id}/${m.id}` })) });
        }
        setGroups(grps);
      }
    })();
  }, [tool?.format]);

  // reveal the selected gateway key so the env block is copy-ready (the whole
  // point of this page is to paste a working config locally). Members use their login key.
  useEffect(() => {
    if (isMember) return;
    if (!ep || ep.keys.length === 0) return;
    void adminApi.revealServerKey(keyIdx).then((r) => setRealKey(r.ok ? r.data?.key ?? "" : ""));
  }, [ep, keyIdx, isMember]);

  if (!tool) return <Empty>Unknown tool.</Empty>;
  if (error) return <Empty>{error}</Empty>;
  if (!ep) return <LoadingDots />;

  const autoBase = `http://127.0.0.1:${ep.port}`;
  const base = selectedBase || autoBase;
  const effectiveKey = customKey.trim() || realKey;
  const env = tool.env(base, effectiveKey);
  const block = env.map((e) => `export ${e.name}="${e.value}"`).join("\n");

  // opencode reads models from ~/.config/opencode/opencode.json, not shell env.
  // Show the exact JSON the auto-apply would MERGE — so the models are visible and
  // it's clear nothing else gets replaced (other providers + your other keys stay).
  const ocModels = picked.length ? picked : cli?.models ?? [];
  const modalitiesFor = (m: string) => {
    const fallback = { input: ["text"], output: ["text"] };
    if (!capsTables) return fallback;
    const refs = comboModels[m];
    if (!refs || refs.length === 0) return modalitiesForModel(m, capsTables);
    const all = refs.map((r) => modalitiesForModel(r, capsTables));
    return {
      input: [...new Set(all.flatMap((a) => a.input))],
      output: [...new Set(all.flatMap((a) => a.output))],
    };
  };
  const opencodeJson =
    tool.id === "opencode"
      ? JSON.stringify(
          {
            provider: {
              aigloo: {
                npm: "@ai-sdk/openai-compatible",
                options: { baseURL: `${base}/v1`, apiKey: effectiveKey || "aigloo" },
                models: Object.fromEntries(ocModels.map((m) => [m, { name: m, modalities: modalitiesFor(m) }])),
              },
            },
            model: `aigloo/${active || ocModels[0] || ""}`,
          },
          null,
          2,
        )
      : null;

  // Claude Code reads its config from ~/.claude/settings.json — show the exact
  // env block the auto-apply writes (merged into the existing settings).
  const claudeJson =
    tool.id === "claude-code"
      ? JSON.stringify(
          {
            hasCompletedOnboarding: true,
            env: {
              ANTHROPIC_BASE_URL: base,
              ...(realKey ? { ANTHROPIC_AUTH_TOKEN: realKey } : {}),
              ...(slots.opus ? { ANTHROPIC_DEFAULT_OPUS_MODEL: slots.opus } : {}),
              ...(slots.sonnet ? { ANTHROPIC_DEFAULT_SONNET_MODEL: slots.sonnet } : {}),
              ...(slots.haiku ? { ANTHROPIC_DEFAULT_HAIKU_MODEL: slots.haiku } : {}),
            },
          },
          null,
          2,
        )
      : null;

  return (
    <div>
      <button onClick={() => router.push("/tools")} className="mb-4 inline-flex items-center gap-1 rounded-brand border border-border bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-muted transition-colors hover:border-text-subtle hover:bg-surface-3 hover:text-text">
        <Icon name="arrow_back" size={14} /> CLI Tools
      </button>

      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-brand bg-surface-2 text-text-muted">
          <Icon name={tool.icon} size={20} />
        </span>
        <h1 className="text-[30px] font-bold tracking-tight heading-gradient heading-accent">{tool.name}</h1>
        <Badge tone="info">{tool.format}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {tool.autoConfig && (
          <RichCard
            className="lg:col-span-2"
            header={
              <>
                <CardTitle
                  title="Local setup"
                  sub={
                    isMember
                      ? "Detects tools on this aigloo host and writes config with your access key + allowed models"
                      : "detect this tool on your machine and write its config for you"
                  }
                />
                {cli && (
                  <Badge tone={!cli.installed ? "neutral" : cli.configured ? "live" : "warn"}>
                    {!cli.installed ? "not detected" : cli.configured ? "configured" : "detected"}
                  </Badge>
                )}
              </>
            }
          >
            {!cli ? (
              <p className="text-[13px] text-text-subtle">Checking your machine…</p>
            ) : !cli.installed ? (
              <p className="text-[13px] text-text-muted">
                Not found on this machine. Install it (above) or paste the manual env below — then re-open this page.
              </p>
            ) : (
              <div className="space-y-3">
                <SetupRow label="Endpoint">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <Select
                        value={selectedBase || "__auto__"}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "__custom__") { setShowCustomBase(true); return; }
                          const next = v === "__auto__" ? "" : v;
                          setSelectedBase(next);
                          localStorage.setItem(`cli-selected-base-${id}`, next);
                        }}
                        className="flex-1"
                      >
                        <option value="__auto__">{autoBase} (auto)</option>
                        {savedBases.map((b) => <option key={b} value={b}>{b}</option>)}
                        <option value="__custom__">Custom URL…</option>
                      </Select>
                      {selectedBase && (
                        <Button variant="ghost" className="px-2 py-1 flex-none" title="remove this URL" onClick={() => {
                          const next = savedBases.filter((x) => x !== selectedBase);
                          setSavedBases(next);
                          localStorage.setItem(`cli-saved-bases-${id}`, JSON.stringify(next));
                          setSelectedBase("");
                          localStorage.setItem(`cli-selected-base-${id}`, "");
                        }}><Icon name="delete" size={15} /></Button>
                      )}
                    </div>
                    {showCustomBase && (
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          value={customBaseInput}
                          onChange={(e) => setCustomBaseInput(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && addCustomBase(customBaseInput)}
                          placeholder="https://your-gateway.example.com"
                          className="flex-1 rounded-brand border border-accent bg-bg px-2.5 py-1.5 font-mono text-[12px] text-text outline-none placeholder:text-text-subtle"
                        />
                        <Button variant="ghost" onClick={() => addCustomBase(customBaseInput)}>Add</Button>
                        <Button variant="ghost" onClick={() => { setShowCustomBase(false); setCustomBaseInput(""); }}>Cancel</Button>
                      </div>
                    )}
                  </div>
                </SetupRow>

                <SetupRow label="API Key">
                  {isMember ? (
                    <div className="text-[13px] text-text-muted">
                      <span className="font-medium text-text">{memberName}</span>
                      {" — "}
                      {customKey || realKey
                        ? "your login key (this browser)"
                        : "Apply uses your session key on the server; paste below only if env copy is empty"}
                      {!customKey && !realKey && (
                        <div className="mt-1.5 flex items-center gap-2">
                          <input
                            value={customKeyInput}
                            onChange={(e) => setCustomKeyInput(e.target.value)}
                            placeholder="paste your access key for env copy…"
                            className="flex-1 rounded-brand border border-border bg-bg px-2.5 py-1.5 font-mono text-[12px] text-text outline-none placeholder:text-text-subtle"
                          />
                          <Button
                            variant="ghost"
                            onClick={() => {
                              const k = customKeyInput.trim();
                              setCustomKey(k);
                              setRealKey(k);
                              try {
                                if (k) sessionStorage.setItem("aigloo_member_key", k);
                              } catch {
                                /* ignore */
                              }
                              setCustomKeyInput("");
                            }}
                          >
                            Use
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <Select
                          value={customKey ? "__custom__" : String(keyIdx)}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "__custom__") { setShowCustomKey(true); return; }
                            setCustomKey("");
                            setKeyIdx(Number(v));
                            localStorage.removeItem(`cli-custom-key-${id}`);
                          }}
                          className="flex-1"
                        >
                          {ep.keys.map((k, i) => <option key={i} value={i}>{k.name || `key ${i + 1}`}</option>)}
                          {customKey && <option value="__custom__">{customKey.slice(0, 12)}… (custom)</option>}
                          {!customKey && <option value="__custom__">Custom key…</option>}
                        </Select>
                        {customKey && (
                          <Button variant="ghost" className="px-2 py-1 flex-none" title="remove custom key" onClick={() => {
                            setCustomKey("");
                            localStorage.removeItem(`cli-custom-key-${id}`);
                          }}><Icon name="delete" size={15} /></Button>
                        )}
                      </div>
                      {showCustomKey && (
                        <div className="flex items-center gap-2">
                          <input
                            autoFocus
                            value={customKeyInput}
                            onChange={(e) => setCustomKeyInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                setCustomKey(customKeyInput.trim());
                                localStorage.setItem(`cli-custom-key-${id}`, customKeyInput.trim());
                                setShowCustomKey(false);
                                setCustomKeyInput("");
                              }
                            }}
                            placeholder="paste API key…"
                            className="flex-1 rounded-brand border border-accent bg-bg px-2.5 py-1.5 font-mono text-[12px] text-text outline-none placeholder:text-text-subtle"
                          />
                          <Button variant="ghost" onClick={() => { setCustomKey(customKeyInput.trim()); localStorage.setItem(`cli-custom-key-${id}`, customKeyInput.trim()); setShowCustomKey(false); setCustomKeyInput(""); }}>Add</Button>
                          <Button variant="ghost" onClick={() => { setShowCustomKey(false); setCustomKeyInput(""); }}>Cancel</Button>
                        </div>
                      )}
                    </div>
                  )}
                </SetupRow>

                {isAnthropic ? (
                  <SetupRow label="Models" top>
                    <div className="flex flex-col gap-2">
                      {(["opus", "sonnet", "haiku"] as const).map((slot) => (
                        <div key={slot} className="flex items-center gap-2">
                          <span className="w-16 flex-none text-[12px] capitalize text-text-subtle">{slot}</span>
                          {slots[slot] ? (
                            <span className="flex flex-1 items-center gap-1.5 rounded border border-accent bg-accent-soft px-2 py-1 font-mono text-[12px] text-accent">
                              <span className="flex-1 truncate">{slots[slot]}</span>
                              <button onClick={() => setSlots((s) => ({ ...s, [slot]: "" }))} className="flex-none hover:text-danger" aria-label="clear">
                                <Icon name="close" size={12} />
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => { setPickerSlot(slot); setPickerOpen(true); }}
                              className="flex items-center gap-1 rounded border border-dashed border-border px-2.5 py-1 text-[12px] text-text-subtle hover:border-accent hover:text-accent"
                            >
                              <Icon name="add" size={13} /> Add model
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </SetupRow>
                ) : (
                  <SetupRow label="Models" top>
                    <div>
                      <div className="flex min-h-[34px] flex-wrap gap-1.5 rounded-brand border border-border-subtle bg-bg px-2 py-1.5">
                        {picked.length === 0 ? (
                          <span className="text-[12px] text-text-subtle">No models — add one below.</span>
                        ) : (
                          picked.map((m) => (
                            <span
                              key={m}
                              onClick={() => setActive((a) => (a === m ? "" : m))}
                              title={m === active ? "active model — click to clear" : "click to set active"}
                              className={`inline-flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-[12px] transition-colors ${
                                m === active ? "border border-accent bg-accent-soft text-accent" : "border border-transparent bg-surface-2 text-text-muted hover:border-border"
                              }`}
                            >
                              {m === active && <Icon name="star" size={11} />}
                              <span className="tnum">{m}</span>
                              <button
                                onClick={(e) => { e.stopPropagation(); setPicked((p) => p.filter((x) => x !== m)); setActive((a) => (a === m ? "" : a)); }}
                                className="hover:text-danger"
                                aria-label={`Remove ${m}`}
                              >
                                <Icon name="close" size={12} />
                              </button>
                            </span>
                          ))
                        )}
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <Button type="button" variant="ghost" onClick={() => setPickerOpen(true)}>
                          <Icon name="add" size={15} /> Add models
                        </Button>
                        <span className="text-[11.5px] text-text-subtle">
                          {active ? <>active: <span className="tnum text-accent">{active}</span></> : picked.length ? "click a chip to set active" : ""}
                        </span>
                      </div>
                    </div>
                  </SetupRow>
                )}

                {cli.configured && cli.baseUrl && (
                  <SetupRow label="Current">
                    <span className="tnum text-[11.5px] text-text-subtle">{cli.baseUrl}</span>
                  </SetupRow>
                )}

                <div className="flex items-center gap-2 border-t border-border-subtle pt-3">
                  <Button onClick={applyCli} disabled={cliBusy === "apply"}>
                    <Icon name={cliBusy === "apply" ? "progress_activity" : "bolt"} size={15} />
                    {cliBusy === "apply" ? "Applying…" : cli.configured ? "Re-apply" : "Apply config"}
                  </Button>
                  {cli.configured && (
                    <Button variant="ghost" onClick={resetCli} disabled={cliBusy === "reset"}>
                      {cliBusy === "reset" ? "Removing…" : "Reset"}
                    </Button>
                  )}
                  {cliMsg && <span className="text-[12px] text-text-subtle">{cliMsg}</span>}
                  {cli.path && <span className="ml-auto truncate tnum text-[11px] text-text-subtle">{cli.path}</span>}
                </div>
              </div>
            )}
          </RichCard>
        )}

        {tool.install && (
          <RichCard header={<CardTitle title="Install" />}>
            <CopyBlock text={tool.install} />
          </RichCard>
        )}

        <RichCard
          className={tool.install ? "" : "lg:col-span-2"}
          header={
            <>
              <CardTitle title="Environment" sub="copy into your shell" />
              {!isMember && ep.keys.length > 1 && (
                <Select
                  value={customKey ? "__custom__" : String(keyIdx)}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__custom__") { setShowCustomKey(true); return; }
                    setCustomKey("");
                    setKeyIdx(Number(v));
                    localStorage.removeItem(`cli-custom-key-${id}`);
                  }}
                  className="max-w-[180px]"
                >
                  {ep.keys.map((k, i) => (
                    <option key={i} value={i}>{k.name || `key ${i + 1}`}</option>
                  ))}
                  {customKey && <option value="__custom__">{customKey.slice(0, 12)}… (custom)</option>}
                  {!customKey && <option value="__custom__">Custom key…</option>}
                </Select>
              )}
            </>
          }
        >
          <CopyBlock text={block} />
          {isMember ? (
            <p className="mt-3 text-[12px] text-text-subtle">
              Using your access key ({memberName}). Apply config writes it on this host even if the env block is empty.
            </p>
          ) : ep.keys.length === 0 ? (
            <p className="mt-3 text-[12px] text-warning">
              No gateway key set — auth is disabled. Add one under Endpoint, then it appears here.
            </p>
          ) : (
            <p className="mt-3 text-[12px] text-text-subtle">
              Using {customKey ? "custom key" : <>key <span className="text-text-muted">{ep.keys[keyIdx]?.name || `#${keyIdx + 1}`}</span></>}. The real value is filled in above.
            </p>
          )}
        </RichCard>

        {opencodeJson && (
          <RichCard
            className="lg:col-span-2"
            header={<CardTitle title="Manual config" sub="merge into ~/.config/opencode/opencode.json — every model listed" />}
          >
            {ocModels.length === 0 ? (
              <p className="text-[13px] text-text-muted">Add models above to see them listed here.</p>
            ) : (
              <CopyBlock text={opencodeJson} />
            )}
            <p className="mt-3 text-[12px] text-text-subtle">
              Apply does the same merge for you — it keeps any other providers and existing models, only adding these.
            </p>
          </RichCard>
        )}

        {claudeJson && (
          <RichCard
            className="lg:col-span-2"
            header={<CardTitle title="Manual config" sub="merge the env block into ~/.claude/settings.json" />}
          >
            <CopyBlock text={claudeJson} />
            <p className="mt-3 text-[12px] text-text-subtle">
              Apply does the same merge for you — it keeps the rest of your settings, only writing these env keys.
            </p>
          </RichCard>
        )}

        {!tool.autoConfig && (
        <RichCard
          className="lg:col-span-2"
          header={<CardTitle title="Models to call" sub="name a combo exactly this — the tool will hit it" />}
        >
          <div className="space-y-1.5">
            {tool.slots.map((s) => {
              const exists = combos.includes(s.alias);
              return (
                <div key={s.alias} className="flex items-center gap-3 rounded-brand border border-border-subtle px-3 py-2">
                  <span className="w-32 flex-none text-[12px] text-text-subtle">{s.label}</span>
                  <Icon name="arrow_forward" size={14} className="flex-none text-text-subtle" />
                  <span className="tnum truncate text-[13px] text-text">{s.alias}</span>
                  <span className="ml-auto flex flex-none items-center gap-2">
                    {exists ? (
                      <Badge tone="live">ready</Badge>
                    ) : (
                      <>
                        <Badge tone="warn">missing</Badge>
                        <button
                          type="button"
                          onClick={() => router.push("/combos")}
                          className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline"
                        >
                          <Icon name="add" size={13} /> create
                        </button>
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          {combos.length > 0 && (
            <p className="mt-2.5 text-[11px] text-text-subtle">
              Your combos: <span className="tnum text-text-muted">{combos.join(", ")}</span>
            </p>
          )}
        </RichCard>
        )}

        <RichCard className="lg:col-span-2" header={<CardTitle title="Steps" />}>
          <ol className="space-y-2.5">
            {tool.steps.map((s, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] text-text-muted">
                <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-surface-2 tnum text-[11px] text-text">
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </RichCard>
      </div>

      {pickerOpen && pickerSlot && (
        <ModelPicker
          title={`Pick model — ${pickerSlot}`}
          note="Click a model to select it for this slot. Pick a thinking level if needed, then Done."
          groups={groups}
          selected={slots[pickerSlot] ? [slots[pickerSlot]] : []}
          onToggle={(v) => {
            setSlots((s) => ({ ...s, [pickerSlot]: s[pickerSlot] === v ? "" : v }));
          }}
          onReplace={(oldV, newV) => {
            setSlots((s) => ({ ...s, [pickerSlot]: s[pickerSlot] === oldV ? newV : s[pickerSlot] }));
          }}
          onClose={() => { setPickerOpen(false); setPickerSlot(null); }}
          singleSelect
          thinkingLevels
        />
      )}
      {pickerOpen && !pickerSlot && (
        <ModelPicker
          title="Add models"
          note="Click a model to add it, click again to remove. Then hit Apply."
          groups={groups}
          selected={picked}
          onToggle={togglePicked}
          onReplace={(oldV, newV) => {
            setPicked((p) => {
              const idx = p.indexOf(oldV);
              if (idx === -1) return p.includes(newV) ? p : [...p, newV];
              const next = [...p];
              next[idx] = newV;
              return next;
            });
          }}
          onClose={() => setPickerOpen(false)}
          thinkingLevels
        />
      )}
    </div>
  );
}

/** label → control row used by the Local setup card (matches aigloo's layout). */
function SetupRow({ label, children, top }: { label: string; children: React.ReactNode; top?: boolean }) {
  return (
    <div className={`grid grid-cols-[7rem_1fr] gap-3 ${top ? "items-start" : "items-center"}`}>
      <span className={`text-[12px] font-medium text-text-subtle ${top ? "pt-1.5" : ""}`}>{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="whitespace-pre-wrap break-words rounded-brand border border-border-subtle bg-bg px-3 py-2.5 font-mono text-[13px] leading-relaxed text-text">
        {text}
      </pre>
      <button
        onClick={() => {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="absolute right-2 top-2 flex items-center gap-1 rounded-brand border border-border bg-surface px-2 py-1 text-[11px] text-text-muted hover:text-text"
      >
        <Icon name={copied ? "check" : "content_copy"} size={13} /> {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}

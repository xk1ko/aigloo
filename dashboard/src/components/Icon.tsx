/** Material Symbols icon. Name = ligature, e.g. "dashboard", "vpn_key", "add". */
export function Icon({
  name,
  size,
  className,
  fill,
}: {
  name: string;
  size?: number;
  className?: string;
  fill?: boolean;
}) {
  return (
    <span
      className={`material-symbols-outlined${className ? ` ${className}` : ""}`}
      style={{
        fontSize: size,
        ...(fill ? { fontVariationSettings: '"FILL" 1, "wght" 400, "GRAD" 0, "opsz" 24' } : {}),
      }}
      aria-hidden
    >
      {name}
    </span>
  );
}

const BADGE_TONE: Record<string, string> = {
  accent: "var(--color-accent)",
  info: "var(--color-info)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
  neutral: "var(--color-text-muted)",
};

/** Tinted rounded-square badge holding a filled icon — for card headers. */
export function IconBadge({
  name,
  tone = "accent",
  size = 38,
}: {
  name: string;
  tone?: keyof typeof BADGE_TONE;
  size?: number;
}) {
  const c = BADGE_TONE[tone] ?? BADGE_TONE.accent;
  return (
    <span
      className="grid shrink-0 place-items-center rounded-brand"
      style={{
        width: size,
        height: size,
        color: c,
        background: `color-mix(in srgb, ${c} 14%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c} 22%, transparent)`,
      }}
      aria-hidden
    >
      <Icon name={name} size={Math.round(size * 0.52)} fill />
    </span>
  );
}

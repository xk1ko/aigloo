export default function UsageLoading() {
  return (
    <div className="space-y-7">
      <div className="overflow-hidden rounded-brand-lg glass-premium animate-pulse">
        <div className="flex flex-col gap-3 px-6 py-5 sm:flex-row">
          <div className="h-16 flex-1 rounded-md bg-surface-2" />
          <div className="h-16 flex-1 rounded-md bg-surface-2" />
          <div className="h-16 flex-1 rounded-md bg-surface-2" />
        </div>
      </div>
      <div>
        <h2 className="mb-3 text-[15px] font-semibold text-text">Requests</h2>
        <div className="h-64 animate-pulse rounded-brand-lg card bg-surface-2" />
      </div>
    </div>
  );
}

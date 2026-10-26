/** Skeleton die de dashboard-layout nabootst, rustiger dan een lege pagina. */
function Bar({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-[var(--sc-fill)] ${className}`} />;
}

export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-2.5 pt-1">
        <Bar className="h-7 w-64" />
        <Bar className="h-4 w-80" />
      </div>

      <div className="sc-glass p-5">
        <Bar className="h-5 w-28" />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <Bar key={i} className="h-16" />)}
        </div>
      </div>

      <div className="grid gap-[18px] lg:grid-cols-[1.6fr_1fr]">
        <div className="sc-glass p-5">
          <Bar className="h-5 w-32" />
          <div className="mt-4 flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => <Bar key={i} className="h-16" />)}
          </div>
        </div>
        <div className="sc-glass p-5">
          <Bar className="h-5 w-28" />
          <Bar className="mt-4 h-16" />
        </div>
      </div>

      <div className="sc-glass p-5">
        <Bar className="h-5 w-40" />
        <div className="mt-4 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Bar key={i} className="aspect-[9/16]" />)}
        </div>
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-1">
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-2">
          <div className="sc-skeleton h-7 w-56" />
          <div className="sc-skeleton h-4 w-72" />
        </div>
        <div className="sc-skeleton h-8 w-40" />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="sc-skeleton h-80 w-full" />
        ))}
      </div>
    </div>
  );
}

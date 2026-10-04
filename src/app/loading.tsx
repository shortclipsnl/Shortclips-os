export default function Loading() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-1">
      <div className="sc-skeleton h-8 w-64" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="sc-skeleton h-24 w-full" />
        ))}
      </div>
      <div className="sc-skeleton h-56 w-full" />
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="sc-skeleton h-72 xl:col-span-2" />
        <div className="sc-skeleton h-72" />
      </div>
    </div>
  );
}

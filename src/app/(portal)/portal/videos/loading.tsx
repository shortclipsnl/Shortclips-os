/** Skeleton voor de video-omgeving: koptekst + rasters met 9:16-tegels. */
function Bar({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-white/5 ${className}`} />;
}

function Grid() {
  return (
    <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Bar key={i} className="aspect-[9/16] rounded-[18px]" />
      ))}
    </div>
  );
}

export default function VideosLoading() {
  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2.5">
        <Bar className="h-7 w-44" />
        <Bar className="h-4 w-96 max-w-full" />
      </div>
      <div className="flex flex-col gap-4">
        <Bar className="h-5 w-40" />
        <Grid />
      </div>
      <div className="flex flex-col gap-4">
        <Bar className="h-5 w-32" />
        <Grid />
      </div>
    </div>
  );
}

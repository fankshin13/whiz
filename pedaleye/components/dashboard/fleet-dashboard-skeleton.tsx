export function FleetDashboardSkeleton() {
  return (
    <div className="grid gap-6" role="status" aria-label="관제 데이터를 불러오는 중" data-fleet-skeleton>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card grid gap-2 p-4">
            <div className="h-4 w-24 rounded-md bg-border motion-safe:animate-pulse" />
            <div className="h-8 w-16 rounded-md bg-border motion-safe:animate-pulse" />
          </div>
        ))}
      </div>
      <div className="card h-64 motion-safe:animate-pulse" />
    </div>
  );
}

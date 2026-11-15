import type { Metadata } from "next";

import { LogoutButton } from "@/app/logout-button";
import { requireUserForPath } from "@/lib/auth/get-current-user";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "대시보드 | 페달아이" };

// 임시 화면: '앱 셸과 네비게이션 구조' 작업이 실제 대시보드로 교체한다.
export default async function DashboardPage() {
  const user = await requireUserForPath("/dashboard");
  const supabase = await createClient();
  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select("id, plate_number, model_name, model_year")
    .order("plate_number");

  if (error) throw new Error(`차량 목록 조회 실패 (${error.code})`);

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>대시보드</h1>
          <p className="muted" style={{ margin: 0 }}>
            {user.name} · {ROLE_LABELS[user.role]}
          </p>
        </div>
        <LogoutButton />
      </header>

      <section className="card" aria-labelledby="vehicles-heading" style={{ display: "grid", gap: "var(--space-4)" }}>
        <h2 id="vehicles-heading">조회 가능한 차량</h2>
        {vehicles.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            배정된 차량이 없습니다. 소속 조직 관리자에게 차량 배정을 요청해 주세요.
          </p>
        ) : (
          <ul className="list">
            {vehicles.map((vehicle) => (
              <li key={vehicle.id} className="list-item">
                <strong>{vehicle.plate_number}</strong>{" "}
                <span className="muted">
                  {vehicle.model_name}
                  {vehicle.model_year ? ` (${vehicle.model_year}년식)` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

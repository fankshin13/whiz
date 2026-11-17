-- 차량 번호는 전국에서 하나뿐이다. 띄어쓰기만 다른 번호("12가 3456" / "12가3456")도 같은 차량으로 보고 중복 등록을 막는다.
-- 조직 관리자는 RLS 때문에 다른 조직 차량을 볼 수 없으므로, 중복 확인은 앱이 아니라 DB 고유 인덱스가 맡는다.
create unique index uq_vehicles_plate_normalized
  on public.vehicles (regexp_replace(plate_number, '\s', '', 'g'));

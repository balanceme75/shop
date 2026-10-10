-- =====================================================================
-- 초록마트 : [3/3] 계정별 장바구니 RPC + 실행 권한
-- =====================================================================

-- 장바구니 응답 생성 (상품 정보 조인 + 할인가 계산)
create or replace function app.cart_payload(p_uid uuid)
returns jsonb language sql security definer
set search_path = app, public, pg_temp as $fn$
  with rows as (
    select c.product_id, c.qty, c.added_at,
           p.name, p.category, p.price, p.discount, p.description, p.img, p.badge,
           round(p.price * (1 - p.discount / 100.0))::int as sale_price
      from app.cart_items c
      join public.products p on p.id = c.product_id
     where c.user_id = p_uid
  )
  select jsonb_build_object(
    'ok', true,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'product_id', product_id, 'name', name, 'category', category,
        'price', price, 'discount', discount, 'sale_price', sale_price,
        'description', description, 'img', img, 'badge', badge,
        'qty', qty, 'line_total', sale_price * qty
      ) order by added_at) from rows), '[]'::jsonb),
    'count',    coalesce((select sum(qty) from rows), 0),
    'subtotal', coalesce((select sum(sale_price * qty) from rows), 0)
  )
$fn$;

-- ---------- 장바구니 조회 ----------
create or replace function public.cart_get(p_token uuid)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_uid uuid;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;
  return app.cart_payload(v_uid);
end $fn$;

-- ---------- 담기 (있으면 수량 누적) ----------
create or replace function public.cart_add(p_token uuid, p_product_id int, p_qty int default 1)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_uid uuid; v_qty int := greatest(1, least(99, coalesce(p_qty, 1)));
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    return app.err('존재하지 않는 상품입니다.');
  end if;

  insert into app.cart_items (user_id, product_id, qty)
  values (v_uid, p_product_id, v_qty)
  on conflict (user_id, product_id) do update
    set qty = least(99, app.cart_items.qty + v_qty), updated_at = now();

  return app.cart_payload(v_uid);
end $fn$;

-- ---------- 수량 지정 (0 이하면 삭제) ----------
create or replace function public.cart_set_qty(p_token uuid, p_product_id int, p_qty int)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_uid uuid;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;

  if coalesce(p_qty, 0) <= 0 then
    delete from app.cart_items where user_id = v_uid and product_id = p_product_id;
  else
    update app.cart_items
       set qty = least(99, p_qty), updated_at = now()
     where user_id = v_uid and product_id = p_product_id;
  end if;

  return app.cart_payload(v_uid);
end $fn$;

-- ---------- 개별 삭제 ----------
create or replace function public.cart_remove(p_token uuid, p_product_id int)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_uid uuid;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;
  delete from app.cart_items where user_id = v_uid and product_id = p_product_id;
  return app.cart_payload(v_uid);
end $fn$;

-- ---------- 전체 비우기 ----------
create or replace function public.cart_clear(p_token uuid)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_uid uuid;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;
  delete from app.cart_items where user_id = v_uid;
  return app.cart_payload(v_uid);
end $fn$;

-- ---------- 비로그인 장바구니 병합 (로그인 직후) ----------
-- p_items 예: [{"product_id":1,"qty":2},{"product_id":5,"qty":1}]
create or replace function public.cart_merge(p_token uuid, p_items jsonb)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_uid uuid;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;

  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    insert into app.cart_items (user_id, product_id, qty)
    select v_uid,
           (e->>'product_id')::int,
           greatest(1, least(99, coalesce((e->>'qty')::int, 1)))
      from jsonb_array_elements(p_items) e
     where (e->>'product_id') ~ '^[0-9]+$'
       and exists (select 1 from public.products p where p.id = (e->>'product_id')::int)
    on conflict (user_id, product_id) do update
      set qty = least(99, app.cart_items.qty + excluded.qty), updated_at = now();
  end if;

  return app.cart_payload(v_uid);
end $fn$;

-- =====================================================================
-- 실행 권한 : anon 키로 RPC 만 호출 가능 / 테이블 직접 접근 불가
-- =====================================================================
do $grant$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'auth\_%' or p.proname like 'cart\_%')
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
end $grant$;

-- app 스키마는 어떤 클라이언트 롤에도 열지 않는다
revoke all on schema app from anon, authenticated;
revoke all on all tables    in schema app from anon, authenticated;
revoke all on all functions in schema app from anon, authenticated;

select 'm3 ok' as step;

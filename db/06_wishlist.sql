-- =====================================================================
-- 초록마트 : [6] 찜하기 (계정별 저장)
-- =====================================================================
create table if not exists app.wishlist (
  user_id    uuid        not null references app.users(id)       on delete cascade,
  product_id int         not null references public.products(id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (user_id, product_id)
);
create index if not exists wishlist_user_idx on app.wishlist (user_id, added_at desc);

-- 찜 목록 응답 (상품 정보 + 할인가 + 재고)
create or replace function app.wish_payload(p_uid uuid)
returns jsonb language sql security definer
set search_path = app, public, pg_temp as $fn$
  with rows as (
    select w.product_id, w.added_at,
           p.name, p.category, p.price, p.discount, p.description, p.img, p.badge, p.stock,
           round(p.price * (1 - p.discount / 100.0))::int as sale_price
      from app.wishlist w
      join public.products p on p.id = w.product_id
     where w.user_id = p_uid
  )
  select jsonb_build_object(
    'ok', true,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'product_id', product_id, 'name', name, 'category', category,
        'price', price, 'discount', discount, 'sale_price', sale_price,
        'description', description, 'img', img, 'badge', badge, 'stock', stock
      ) order by added_at desc) from rows), '[]'::jsonb),
    'ids',   coalesce((select jsonb_agg(product_id) from rows), '[]'::jsonb),
    'count', (select count(*) from rows)
  )
$fn$;

-- ---------- 찜 목록 조회 ----------
create or replace function public.wishlist_get(p_token uuid)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_uid uuid;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;
  return app.wish_payload(v_uid);
end $fn$;

-- ---------- 찜 토글 (하트 버튼) ----------
create or replace function public.wishlist_toggle(p_token uuid, p_product_id int)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_uid uuid; v_wished boolean; v_name text;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;

  select name into v_name from public.products where id = p_product_id;
  if v_name is null then return app.err('존재하지 않는 상품입니다.'); end if;

  if exists (select 1 from app.wishlist where user_id = v_uid and product_id = p_product_id) then
    delete from app.wishlist where user_id = v_uid and product_id = p_product_id;
    v_wished := false;
  else
    insert into app.wishlist (user_id, product_id) values (v_uid, p_product_id)
      on conflict do nothing;
    v_wished := true;
  end if;

  return app.wish_payload(v_uid)
      || jsonb_build_object('wished', v_wished, 'product_name', v_name,
           'message', case when v_wished then '찜 목록에 담았습니다.'
                           else '찜 목록에서 뺐습니다.' end);
end $fn$;

-- ---------- 찜 해제 ----------
create or replace function public.wishlist_remove(p_token uuid, p_product_id int)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_uid uuid;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;
  delete from app.wishlist where user_id = v_uid and product_id = p_product_id;
  return app.wish_payload(v_uid);
end $fn$;

-- ---------- 찜 -> 장바구니 담기 (찜은 유지) ----------
create or replace function public.wishlist_to_cart(p_token uuid, p_product_id int)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_uid uuid; v_stock int;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;

  select stock into v_stock from public.products where id = p_product_id;
  if v_stock is null then return app.err('존재하지 않는 상품입니다.'); end if;
  if v_stock <= 0 then return app.err('품절된 상품입니다.'); end if;

  insert into app.cart_items (user_id, product_id, qty)
  values (v_uid, p_product_id, 1)
  on conflict (user_id, product_id) do update
    set qty = least(99, app.cart_items.qty + 1), updated_at = now();

  return app.cart_payload(v_uid) || jsonb_build_object('message', '장바구니에 담았습니다.');
end $fn$;

-- ---------- auth_me 에 찜 개수 추가 ----------
create or replace function public.auth_me(p_token uuid)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_uid uuid; r app.users; v_cart int; v_wish int;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;

  select * into r from app.users where id = v_uid;
  select coalesce(sum(qty), 0) into v_cart from app.cart_items where user_id = v_uid;
  select count(*)              into v_wish from app.wishlist   where user_id = v_uid;

  return jsonb_build_object('ok', true,
    'user', jsonb_build_object(
      'id', r.id, 'username', r.username,
      'birthdate', r.birthdate,
      'phone', r.phone,
      'phone_masked', case when r.phone is null then null
                           else left(r.phone, 3) || '-****-' || right(r.phone, 4) end,
      'has_recovery', (r.birthdate is not null and r.phone is not null),
      'created_at', r.created_at),
    'cart_count', v_cart,
    'wish_count', v_wish);
end $fn$;

-- 권한 재적용
do $grant$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'auth\_%' or p.proname like 'cart\_%'
            or p.proname like 'wishlist\_%' or p.proname like 'order\_%')
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
end $grant$;

revoke all on all tables    in schema app from anon, authenticated;
revoke all on all functions in schema app from anon, authenticated;

select 'm6 ok' as step;

-- =====================================================================
-- 초록마트 : [9] 주소록 + 배송비 정책(3만원 이상 무료) + 복원 안정화
-- =====================================================================

-- ---------- 상점 설정 (배송 정책을 DB 에 보관) ----------
create table if not exists app.shop_config (
  key        text primary key,
  value      jsonb       not null,
  note       text,
  updated_at timestamptz not null default now()
);

insert into app.shop_config (key, value, note) values
  ('free_shipping_threshold', '30000'::jsonb, '이 금액 이상이면 배송비 무료'),
  ('shipping_fee',            '3000'::jsonb,  '기본 배송비')
on conflict (key) do nothing;

create or replace function app.cfg_int(p_key text, p_default int)
returns int language sql stable
set search_path = app, pg_temp as $fn$
  select coalesce((select value::text::int from app.shop_config where key = p_key), p_default)
$fn$;

-- 주문금액에 따른 배송비 계산 (한 곳에서만 계산하도록 집중)
create or replace function app.calc_shipping(p_subtotal int)
returns int language sql stable
set search_path = app, pg_temp as $fn$
  select case
    when coalesce(p_subtotal, 0) <= 0 then 0
    when p_subtotal >= app.cfg_int('free_shipping_threshold', 30000) then 0
    else app.cfg_int('shipping_fee', 3000)
  end
$fn$;

-- 배송 정책 공개 조회 (프론트 안내 문구용)
create or replace function public.shop_shipping_policy()
returns jsonb language sql security definer
set search_path = app, public, pg_temp as $fn$
  select jsonb_build_object(
    'ok', true,
    'free_threshold', app.cfg_int('free_shipping_threshold', 30000),
    'shipping_fee',   app.cfg_int('shipping_fee', 3000))
$fn$;

-- ---------- 장바구니 응답에 배송비 계산 포함 ----------
create or replace function app.cart_payload(p_uid uuid)
returns jsonb language sql security definer
set search_path = app, public, pg_temp as $fn$
  with rows as (
    select c.product_id, c.qty, c.added_at,
           p.name, p.category, p.price, p.discount, p.description, p.img, p.badge, p.stock,
           round(p.price * (1 - p.discount / 100.0))::int as sale_price
      from app.cart_items c
      join public.products p on p.id = c.product_id
     where c.user_id = p_uid
  ), agg as (
    select coalesce(sum(qty), 0)::int                  as cnt,
           coalesce(sum(sale_price * qty), 0)::int     as sub
      from rows
  )
  select jsonb_build_object(
    'ok', true,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'product_id', product_id, 'name', name, 'category', category,
        'price', price, 'discount', discount, 'sale_price', sale_price,
        'description', description, 'img', img, 'badge', badge, 'stock', stock,
        'qty', qty, 'line_total', sale_price * qty
      ) order by added_at) from rows), '[]'::jsonb),
    'count',          (select cnt from agg),
    'subtotal',       (select sub from agg),
    'shipping_fee',   app.calc_shipping((select sub from agg)),
    'total',          (select sub from agg) + app.calc_shipping((select sub from agg)),
    'free_threshold', app.cfg_int('free_shipping_threshold', 30000),
    'free_remain',    greatest(0, app.cfg_int('free_shipping_threshold', 30000) - (select sub from agg))
  )
$fn$;

-- ---------- 주소록 ----------
create table if not exists app.addresses (
  id             bigserial   primary key,
  user_id        uuid        not null references app.users(id) on delete cascade,
  label          text,                       -- '집', '회사' 등
  receiver_name  text        not null,
  receiver_phone text        not null,
  postcode       text        not null,
  address1       text        not null,
  address2       text        not null,
  is_default     boolean     not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists addresses_user_idx on app.addresses (user_id, is_default desc, updated_at desc);
-- 회원당 기본 배송지는 하나만
create unique index if not exists addresses_one_default
  on app.addresses (user_id) where is_default;

create or replace function app.addr_payload(p_uid uuid)
returns jsonb language sql security definer
set search_path = app, pg_temp as $fn$
  select jsonb_build_object(
    'ok', true,
    'addresses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'label', label,
        'receiver_name', receiver_name, 'receiver_phone', receiver_phone,
        'postcode', postcode, 'address1', address1, 'address2', address2,
        'is_default', is_default, 'created_at', created_at
      ) order by is_default desc, updated_at desc)
      from app.addresses where user_id = p_uid), '[]'::jsonb))
$fn$;

-- 배송지 입력값 검증 (여러 곳에서 공용)
create or replace function app.bad_address(
  p_name text, p_phone text, p_post text, p_a1 text, p_a2 text)
returns text language sql immutable
set search_path = app, pg_temp as $fn$
  select case
    when coalesce(btrim(p_name), '') = ''            then '받는 분 성함을 입력해 주세요.'
    when app.norm_phone(p_phone) !~ '^0[0-9]{8,10}$' then '받는 분 연락처를 정확히 입력해 주세요.'
    when app.norm_phone(p_post)  !~ '^[0-9]{5}$'     then '우편번호 5자리를 입력해 주세요.'
    when coalesce(btrim(p_a1), '') = ''              then '주소를 입력해 주세요.'
    when coalesce(btrim(p_a2), '') = ''              then '상세주소를 입력해 주세요.'
    else null end
$fn$;

create or replace function public.address_list(p_token uuid)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_uid uuid;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;
  return app.addr_payload(v_uid);
end $fn$;

create or replace function public.address_add(
  p_token uuid, p_label text, p_receiver_name text, p_receiver_phone text,
  p_postcode text, p_address1 text, p_address2 text, p_is_default boolean default false
) returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_uid uuid; v_bad text; v_cnt int; v_def boolean;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;

  v_bad := app.bad_address(p_receiver_name, p_receiver_phone, p_postcode, p_address1, p_address2);
  if v_bad is not null then return app.err(v_bad); end if;

  select count(*) into v_cnt from app.addresses where user_id = v_uid;
  if v_cnt >= 20 then return app.err('주소록은 최대 20개까지 저장할 수 있습니다.'); end if;

  v_def := coalesce(p_is_default, false) or v_cnt = 0;   -- 첫 주소는 자동으로 기본
  if v_def then
    update app.addresses set is_default = false, updated_at = now()
     where user_id = v_uid and is_default;
  end if;

  insert into app.addresses (user_id, label, receiver_name, receiver_phone,
                             postcode, address1, address2, is_default)
  values (v_uid, nullif(btrim(coalesce(p_label, '')), ''), btrim(p_receiver_name),
          app.norm_phone(p_receiver_phone), app.norm_phone(p_postcode),
          btrim(p_address1), btrim(p_address2), v_def);

  return app.addr_payload(v_uid) || jsonb_build_object('message', '주소록에 저장했습니다.');
end $fn$;

create or replace function public.address_update(
  p_token uuid, p_id bigint, p_label text, p_receiver_name text, p_receiver_phone text,
  p_postcode text, p_address1 text, p_address2 text, p_is_default boolean default false
) returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_uid uuid; v_bad text;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;

  if not exists (select 1 from app.addresses where id = p_id and user_id = v_uid) then
    return app.err('주소를 찾을 수 없습니다.');
  end if;

  v_bad := app.bad_address(p_receiver_name, p_receiver_phone, p_postcode, p_address1, p_address2);
  if v_bad is not null then return app.err(v_bad); end if;

  if coalesce(p_is_default, false) then
    update app.addresses set is_default = false, updated_at = now()
     where user_id = v_uid and is_default and id <> p_id;
  end if;

  update app.addresses
     set label          = nullif(btrim(coalesce(p_label, '')), ''),
         receiver_name  = btrim(p_receiver_name),
         receiver_phone = app.norm_phone(p_receiver_phone),
         postcode       = app.norm_phone(p_postcode),
         address1       = btrim(p_address1),
         address2       = btrim(p_address2),
         is_default     = coalesce(p_is_default, is_default),
         updated_at     = now()
   where id = p_id and user_id = v_uid;

  return app.addr_payload(v_uid) || jsonb_build_object('message', '주소를 수정했습니다.');
end $fn$;

create or replace function public.address_delete(p_token uuid, p_id bigint)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_uid uuid; v_was_default boolean;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;

  select is_default into v_was_default from app.addresses where id = p_id and user_id = v_uid;
  if v_was_default is null then return app.err('주소를 찾을 수 없습니다.'); end if;

  delete from app.addresses where id = p_id and user_id = v_uid;

  -- 기본 배송지를 지웠다면 가장 최근 주소를 기본으로 승격
  if v_was_default then
    update app.addresses set is_default = true, updated_at = now()
     where id = (select id from app.addresses where user_id = v_uid
                  order by updated_at desc limit 1);
  end if;

  return app.addr_payload(v_uid) || jsonb_build_object('message', '주소를 삭제했습니다.');
end $fn$;

create or replace function public.address_set_default(p_token uuid, p_id bigint)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_uid uuid;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;
  if not exists (select 1 from app.addresses where id = p_id and user_id = v_uid) then
    return app.err('주소를 찾을 수 없습니다.');
  end if;

  update app.addresses set is_default = false, updated_at = now()
   where user_id = v_uid and is_default;
  update app.addresses set is_default = true, updated_at = now()
   where id = p_id and user_id = v_uid;

  return app.addr_payload(v_uid) || jsonb_build_object('message', '기본 배송지로 설정했습니다.');
end $fn$;

-- ---------- 찜 병합 (토글이 아니라 "추가만" — 재로그인 시 유실 방지) ----------
create or replace function public.wishlist_merge(p_token uuid, p_ids jsonb)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_uid uuid;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;

  if p_ids is not null and jsonb_typeof(p_ids) = 'array' then
    insert into app.wishlist (user_id, product_id)
    select v_uid, (e#>>'{}')::int
      from jsonb_array_elements(p_ids) e
     where (e#>>'{}') ~ '^[0-9]+$'
       and exists (select 1 from public.products p where p.id = (e#>>'{}')::int)
    on conflict (user_id, product_id) do nothing;   -- 이미 있으면 그대로 둔다
  end if;

  return app.wish_payload(v_uid);
end $fn$;

-- ---------- 로그인 복원 한 번에 (회원 + 장바구니 + 찜 + 주소록) ----------
create or replace function public.session_bootstrap(p_token uuid)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_uid uuid; r app.users;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;

  select * into r from app.users where id = v_uid;

  return jsonb_build_object('ok', true,
    'user', jsonb_build_object(
      'id', r.id, 'username', r.username,
      'birthdate', r.birthdate, 'phone', r.phone,
      'phone_masked', case when r.phone is null then null
                           else left(r.phone, 3) || '-****-' || right(r.phone, 4) end,
      'has_recovery', (r.birthdate is not null and r.phone is not null),
      'created_at', r.created_at),
    'cart',      app.cart_payload(v_uid),
    'wishlist',  app.wish_payload(v_uid),
    'addresses', app.addr_payload(v_uid)->'addresses',
    'shipping',  jsonb_build_object(
                   'free_threshold', app.cfg_int('free_shipping_threshold', 30000),
                   'shipping_fee',   app.cfg_int('shipping_fee', 3000)));
end $fn$;

-- ---------- 주문서 미리보기: 배송비 반영 ----------
create or replace function public.order_preview(p_token uuid)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_uid uuid; v_cart jsonb; v_short jsonb;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;

  v_cart := app.cart_payload(v_uid);   -- shipping_fee / total / free_remain 포함

  select jsonb_agg(jsonb_build_object('name', p.name, 'want', c.qty, 'stock', p.stock))
    into v_short
    from app.cart_items c join public.products p on p.id = c.product_id
   where c.user_id = v_uid and p.stock < c.qty;

  return v_cart
      || jsonb_build_object('shortage', coalesce(v_short, '[]'::jsonb))
      || (app.addr_payload(v_uid));    -- addresses 함께 전달
end $fn$;

-- ---------- 주문 생성: 배송비 계산 + 주소록 저장 옵션 ----------
create or replace function public.order_create(
  p_token          uuid,
  p_receiver_name  text,
  p_receiver_phone text,
  p_postcode       text,
  p_address1       text,
  p_address2       text default null,
  p_memo           text default null,
  p_save_address   boolean default false,
  p_address_label  text default null
) returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare
  v_uid  uuid;
  v_bad  text;
  v_cnt  int;
  v_sub  int;
  v_ship int;
  v_oid  bigint;
  v_no   text;
  r      record;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;

  v_bad := app.bad_address(p_receiver_name, p_receiver_phone, p_postcode, p_address1, p_address2);
  if v_bad is not null then return app.err(v_bad); end if;

  select count(*) into v_cnt from app.cart_items where user_id = v_uid;
  if v_cnt = 0 then return app.err('장바구니가 비어 있습니다.'); end if;

  for r in
    select c.product_id, c.qty, p.name, p.stock
      from app.cart_items c
      join public.products p on p.id = c.product_id
     where c.user_id = v_uid
     order by c.product_id
       for update of p
  loop
    if r.stock < r.qty then
      return app.err(r.name || ' 상품의 재고가 부족합니다. (주문 ' || r.qty ||
                     '개 / 재고 ' || r.stock || '개)');
    end if;
  end loop;

  select coalesce(sum(round(p.price * (1 - p.discount / 100.0))::int * c.qty), 0)
    into v_sub
    from app.cart_items c join public.products p on p.id = c.product_id
   where c.user_id = v_uid;

  v_ship := app.calc_shipping(v_sub);          -- 3만원 이상이면 0

  v_no := 'CM' || to_char(now() at time zone 'Asia/Seoul', 'YYMMDD')
          || '-' || lpad(nextval('app.order_no_seq')::text, 5, '0');

  insert into app.orders (order_no, user_id, receiver_name, receiver_phone,
                          postcode, address1, address2, memo,
                          subtotal, shipping_fee, total)
  values (v_no, v_uid, btrim(p_receiver_name), app.norm_phone(p_receiver_phone),
          app.norm_phone(p_postcode), btrim(p_address1), btrim(p_address2),
          nullif(btrim(coalesce(p_memo, '')), ''),
          v_sub, v_ship, v_sub + v_ship)
  returning id into v_oid;

  insert into app.order_items (order_id, product_id, name, category, img,
                               price, discount, sale_price, qty, line_total)
  select v_oid, p.id, p.name, p.category, p.img, p.price, p.discount,
         round(p.price * (1 - p.discount / 100.0))::int,
         c.qty,
         round(p.price * (1 - p.discount / 100.0))::int * c.qty
    from app.cart_items c join public.products p on p.id = c.product_id
   where c.user_id = v_uid
   order by c.added_at;

  update public.products p
     set stock = p.stock - c.qty
    from app.cart_items c
   where c.user_id = v_uid and p.id = c.product_id;

  delete from app.cart_items where user_id = v_uid;

  -- 주소록 저장 (같은 주소가 이미 있으면 저장하지 않음)
  if coalesce(p_save_address, false)
     and not exists (
       select 1 from app.addresses
        where user_id = v_uid
          and postcode = app.norm_phone(p_postcode)
          and address1 = btrim(p_address1)
          and address2 = btrim(p_address2))
  then
    insert into app.addresses (user_id, label, receiver_name, receiver_phone,
                               postcode, address1, address2, is_default)
    values (v_uid, nullif(btrim(coalesce(p_address_label, '')), ''),
            btrim(p_receiver_name), app.norm_phone(p_receiver_phone),
            app.norm_phone(p_postcode), btrim(p_address1), btrim(p_address2),
            not exists (select 1 from app.addresses where user_id = v_uid));
  end if;

  return app.order_payload(v_oid) || jsonb_build_object(
    'message', '주문이 접수되었습니다. 주문번호 ' || v_no);
end $fn$;

-- 권한 적용
do $grant$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'auth\_%'     or p.proname like 'cart\_%'
         or p.proname like 'wishlist\_%' or p.proname like 'order\_%'
         or p.proname like 'address\_%'  or p.proname like 'shop\_%'
         or p.proname = 'session_bootstrap')
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
end $grant$;

revoke all on all tables    in schema app from anon, authenticated;
revoke all on all functions in schema app from anon, authenticated;

select 'm9 ok' as step;

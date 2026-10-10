-- =====================================================================
-- 초록마트 : [7] 주문서 / 주문 내역 (배송지 + 우편번호 + 주문상품 + 재고차감)
-- =====================================================================

create sequence if not exists app.order_no_seq;

create table if not exists app.orders (
  id             bigserial   primary key,
  order_no       text        not null unique,
  user_id        uuid        not null references app.users(id) on delete cascade,
  receiver_name  text        not null,
  receiver_phone text        not null,
  postcode       text        not null,
  address1       text        not null,          -- 도로명/지번 주소
  address2       text,                          -- 상세주소
  memo           text,                          -- 배송 요청사항
  subtotal       int         not null,
  shipping_fee   int         not null default 0,
  total          int         not null,
  status         text        not null default '결제완료',
  created_at     timestamptz not null default now()
);
create index if not exists orders_user_idx on app.orders (user_id, created_at desc);

create table if not exists app.order_items (
  id         bigserial primary key,
  order_id   bigint not null references app.orders(id) on delete cascade,
  product_id int    references public.products(id) on delete set null,
  name       text   not null,     -- 주문 시점 스냅샷 (상품이 바뀌어도 주문서는 유지)
  category   text,
  img        text,
  price      int    not null,
  discount   int    not null,
  sale_price int    not null,
  qty        int    not null,
  line_total int    not null
);
create index if not exists order_items_order_idx on app.order_items (order_id);

-- ---------- 주문 응답 생성 ----------
create or replace function app.order_payload(p_order_id bigint)
returns jsonb language sql security definer
set search_path = app, public, pg_temp as $fn$
  select jsonb_build_object(
    'ok', true,
    'order', jsonb_build_object(
      'id', o.id, 'order_no', o.order_no, 'status', o.status,
      'receiver_name', o.receiver_name, 'receiver_phone', o.receiver_phone,
      'postcode', o.postcode, 'address1', o.address1, 'address2', o.address2,
      'memo', o.memo,
      'subtotal', o.subtotal, 'shipping_fee', o.shipping_fee, 'total', o.total,
      'created_at', o.created_at,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'product_id', i.product_id, 'name', i.name, 'category', i.category,
          'img', i.img, 'price', i.price, 'discount', i.discount,
          'sale_price', i.sale_price, 'qty', i.qty, 'line_total', i.line_total
        ) order by i.id)
        from app.order_items i where i.order_id = o.id), '[]'::jsonb)
    ))
  from app.orders o where o.id = p_order_id
$fn$;

-- ---------- 주문서 미리보기 (장바구니 + 배송비 + 재고 경고) ----------
create or replace function public.order_preview(p_token uuid)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_uid uuid; v_cart jsonb; v_short jsonb;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;

  v_cart := app.cart_payload(v_uid);

  -- 재고가 모자란 품목
  select jsonb_agg(jsonb_build_object('name', p.name, 'want', c.qty, 'stock', p.stock))
    into v_short
    from app.cart_items c join public.products p on p.id = c.product_id
   where c.user_id = v_uid and p.stock < c.qty;

  return v_cart || jsonb_build_object(
    'shipping_fee', 0,                                   -- 전 상품 무료배송
    'total', (v_cart->>'subtotal')::int,
    'shortage', coalesce(v_short, '[]'::jsonb)
  );
end $fn$;

-- ---------- 주문 생성 (재고 차감 + 장바구니 비우기) ----------
create or replace function public.order_create(
  p_token          uuid,
  p_receiver_name  text,
  p_receiver_phone text,
  p_postcode       text,
  p_address1       text,
  p_address2       text default null,
  p_memo           text default null
) returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare
  v_uid   uuid;
  v_cnt   int;
  v_sub   int;
  v_ship  int := 0;
  v_oid   bigint;
  v_no    text;
  r       record;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;

  -- 배송지 검증
  if coalesce(btrim(p_receiver_name), '') = '' then
    return app.err('받는 분 성함을 입력해 주세요.');
  end if;
  if app.norm_phone(p_receiver_phone) !~ '^0[0-9]{8,10}$' then
    return app.err('받는 분 연락처를 정확히 입력해 주세요.');
  end if;
  if app.norm_phone(p_postcode) !~ '^[0-9]{5}$' then
    return app.err('우편번호 5자리를 입력해 주세요.');
  end if;
  if coalesce(btrim(p_address1), '') = '' then
    return app.err('주소를 입력해 주세요.');
  end if;
  if coalesce(btrim(p_address2), '') = '' then
    return app.err('상세주소를 입력해 주세요.');
  end if;

  select count(*) into v_cnt from app.cart_items where user_id = v_uid;
  if v_cnt = 0 then return app.err('장바구니가 비어 있습니다.'); end if;

  -- 재고 확인 (동시 주문 방지를 위해 상품 행을 잠금)
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

  -- 주문 상품 스냅샷
  insert into app.order_items (order_id, product_id, name, category, img,
                               price, discount, sale_price, qty, line_total)
  select v_oid, p.id, p.name, p.category, p.img, p.price, p.discount,
         round(p.price * (1 - p.discount / 100.0))::int,
         c.qty,
         round(p.price * (1 - p.discount / 100.0))::int * c.qty
    from app.cart_items c join public.products p on p.id = c.product_id
   where c.user_id = v_uid
   order by c.added_at;

  -- 재고 차감
  update public.products p
     set stock = p.stock - c.qty
    from app.cart_items c
   where c.user_id = v_uid and p.id = c.product_id;

  -- 장바구니 비우기
  delete from app.cart_items where user_id = v_uid;

  return app.order_payload(v_oid) || jsonb_build_object(
    'message', '주문이 접수되었습니다. 주문번호 ' || v_no);
end $fn$;

-- ---------- 주문 내역 목록 ----------
create or replace function public.order_list(p_token uuid)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_uid uuid; v_list jsonb;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;

  select jsonb_agg(jsonb_build_object(
           'id', o.id, 'order_no', o.order_no, 'status', o.status,
           'total', o.total, 'created_at', o.created_at,
           'item_count', (select coalesce(sum(i.qty), 0) from app.order_items i where i.order_id = o.id),
           'first_name', (select i.name from app.order_items i where i.order_id = o.id order by i.id limit 1),
           'first_img',  (select i.img  from app.order_items i where i.order_id = o.id order by i.id limit 1)
         ) order by o.created_at desc)
    into v_list
    from app.orders o where o.user_id = v_uid;

  return jsonb_build_object('ok', true, 'orders', coalesce(v_list, '[]'::jsonb));
end $fn$;

-- ---------- 주문 상세 ----------
create or replace function public.order_detail(p_token uuid, p_order_no text)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_uid uuid; v_oid bigint;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;

  select id into v_oid from app.orders
   where user_id = v_uid and order_no = p_order_no;      -- 본인 주문만
  if v_oid is null then return app.err('주문을 찾을 수 없습니다.'); end if;

  return app.order_payload(v_oid);
end $fn$;

-- ---------- 마지막 배송지 (주문서 자동 채움) ----------
create or replace function public.order_last_address(p_token uuid)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_uid uuid; o app.orders;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;

  select * into o from app.orders
   where user_id = v_uid order by created_at desc limit 1;

  if not found then return jsonb_build_object('ok', true, 'address', null); end if;

  return jsonb_build_object('ok', true, 'address', jsonb_build_object(
    'receiver_name', o.receiver_name, 'receiver_phone', o.receiver_phone,
    'postcode', o.postcode, 'address1', o.address1, 'address2', o.address2));
end $fn$;

-- 권한 적용
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

select 'm7 ok' as step;

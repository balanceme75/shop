-- =====================================================================
-- 초록마트 : [8] 장바구니 담기 단계에서도 재고 검사
-- =====================================================================
create or replace function public.cart_add(p_token uuid, p_product_id int, p_qty int default 1)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare
  v_uid uuid;
  v_qty int := greatest(1, least(99, coalesce(p_qty, 1)));
  v_stock int;
  v_name text;
  v_have int;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;

  select stock, name into v_stock, v_name from public.products where id = p_product_id;
  if v_name is null then return app.err('존재하지 않는 상품입니다.'); end if;
  if v_stock <= 0 then return app.err(v_name || ' 상품은 품절되었습니다.'); end if;

  select coalesce(qty, 0) into v_have
    from app.cart_items where user_id = v_uid and product_id = p_product_id;
  v_have := coalesce(v_have, 0);

  if v_have + v_qty > v_stock then
    return app.err(v_name || ' 상품은 재고가 ' || v_stock || '개 남아 있습니다.');
  end if;

  insert into app.cart_items (user_id, product_id, qty)
  values (v_uid, p_product_id, v_qty)
  on conflict (user_id, product_id) do update
    set qty = least(99, app.cart_items.qty + v_qty), updated_at = now();

  return app.cart_payload(v_uid);
end $fn$;

-- 수량 직접 지정도 재고 상한을 넘지 않게
create or replace function public.cart_set_qty(p_token uuid, p_product_id int, p_qty int)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_uid uuid; v_stock int; v_name text;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;

  if coalesce(p_qty, 0) <= 0 then
    delete from app.cart_items where user_id = v_uid and product_id = p_product_id;
    return app.cart_payload(v_uid);
  end if;

  select stock, name into v_stock, v_name from public.products where id = p_product_id;
  if v_name is null then return app.err('존재하지 않는 상품입니다.'); end if;

  if p_qty > v_stock then
    update app.cart_items set qty = greatest(1, v_stock), updated_at = now()
     where user_id = v_uid and product_id = p_product_id;
    return app.cart_payload(v_uid)
        || jsonb_build_object('notice', v_name || ' 상품은 재고가 ' || v_stock || '개까지만 가능합니다.');
  end if;

  update app.cart_items set qty = least(99, p_qty), updated_at = now()
   where user_id = v_uid and product_id = p_product_id;

  return app.cart_payload(v_uid);
end $fn$;

do $grant$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('cart_add', 'cart_set_qty')
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
end $grant$;

select 'm8 ok' as step;

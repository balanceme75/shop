-- =====================================================================
-- 초록마트 : [4] 가입 최소화
--   가입 필수 = 아이디 + 비밀번호 2개
--   생년월일/휴대폰 = 분실 복구용 선택 정보 (가입 직후 또는 나중에 등록)
-- =====================================================================
alter table app.users alter column birthdate drop not null;
alter table app.users alter column phone     drop not null;

-- ---------- 회원가입: 아이디 + 비번만으로 가능 ----------
create or replace function public.auth_signup(
  p_username  text,
  p_password  text,
  p_birthdate date default null,
  p_phone     text default null
) returns jsonb language plpgsql security definer
set search_path = app, public, extensions, pg_temp as $fn$
declare
  v_u text := app.norm_username(p_username);
  v_p text := nullif(app.norm_phone(p_phone), '');
  v_bad text;
  v_id uuid;
  v_token uuid;
begin
  -- 필수: 아이디 + 비밀번호
  v_bad := coalesce(app.bad_username(p_username), app.bad_password(p_password));
  if v_bad is not null then return app.err(v_bad); end if;

  -- 선택: 복구 정보는 "둘 다" 또는 "둘 다 없음"
  if (p_birthdate is null) <> (v_p is null) then
    return app.err('생년월일과 휴대폰 번호는 함께 입력해 주세요.');
  end if;
  if p_birthdate is not null then
    v_bad := coalesce(app.bad_birthdate(p_birthdate), app.bad_phone(v_p));
    if v_bad is not null then return app.err(v_bad); end if;
  end if;

  if exists (select 1 from app.users where username = v_u) then
    return app.err('이미 사용 중인 아이디입니다.');
  end if;

  insert into app.users (username, password_hash, birthdate, phone)
  values (v_u, extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
          p_birthdate, v_p)
  returning id into v_id;

  insert into app.sessions (user_id) values (v_id) returning token into v_token;

  return jsonb_build_object(
    'ok', true, 'token', v_token,
    'user', jsonb_build_object('id', v_id, 'username', v_u),
    'has_recovery', (p_birthdate is not null),
    'message', '회원가입이 완료되었습니다.');
exception
  when unique_violation then return app.err('이미 사용 중인 아이디입니다.');
end $fn$;

-- ---------- 내 정보: 복구 정보 등록 여부 포함 ----------
create or replace function public.auth_me(p_token uuid)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_uid uuid; r app.users; v_cnt int;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;

  select * into r from app.users where id = v_uid;
  select coalesce(sum(qty), 0) into v_cnt from app.cart_items where user_id = v_uid;

  return jsonb_build_object('ok', true,
    'user', jsonb_build_object(
      'id', r.id, 'username', r.username,
      'birthdate', r.birthdate,
      'phone', r.phone,
      'phone_masked', case when r.phone is null then null
                           else left(r.phone, 3) || '-****-' || right(r.phone, 4) end,
      'has_recovery', (r.birthdate is not null and r.phone is not null),
      'created_at', r.created_at),
    'cart_count', v_cnt);
end $fn$;

-- ---------- 아이디 찾기: 복구 정보 등록 계정만 ----------
create or replace function public.auth_find_id(p_birthdate date, p_phone text)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_bad text; v_list jsonb;
begin
  v_bad := coalesce(app.bad_birthdate(p_birthdate), app.bad_phone(p_phone));
  if v_bad is not null then return app.err(v_bad); end if;

  select jsonb_agg(jsonb_build_object('username', username, 'created_at', created_at)
                   order by created_at)
    into v_list
    from app.users
   where birthdate is not null and phone is not null
     and birthdate = p_birthdate and phone = app.norm_phone(p_phone);

  if v_list is null then
    return app.err('입력한 정보와 일치하는 회원이 없습니다. 복구 정보를 등록하지 않은 계정은 찾을 수 없습니다.');
  end if;
  return jsonb_build_object('ok', true, 'accounts', v_list);
end $fn$;

-- ---------- 비밀번호 재설정: 복구 정보 등록 계정만 ----------
create or replace function public.auth_reset_password(
  p_username     text,
  p_birthdate    date,
  p_phone        text,
  p_new_password text
) returns jsonb language plpgsql security definer
set search_path = app, public, extensions, pg_temp as $fn$
declare v_bad text; r app.users;
begin
  v_bad := coalesce(app.bad_username(p_username), app.bad_birthdate(p_birthdate),
                    app.bad_phone(p_phone), app.bad_password(p_new_password));
  if v_bad is not null then return app.err(v_bad); end if;

  select * into r from app.users where username = app.norm_username(p_username);
  if not found then
    return app.err('입력한 정보와 일치하는 회원이 없습니다.');
  end if;
  if r.birthdate is null or r.phone is null then
    return app.err('이 계정에는 복구 정보(생년월일·휴대폰)가 등록되어 있지 않아 재설정할 수 없습니다.');
  end if;
  if r.birthdate <> p_birthdate or r.phone <> app.norm_phone(p_phone) then
    return app.err('입력한 정보와 일치하는 회원이 없습니다.');
  end if;

  update app.users
     set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
         failed_count  = 0, locked_until = null, updated_at = now()
   where id = r.id;

  delete from app.sessions where user_id = r.id;   -- 보안상 전체 로그아웃

  return jsonb_build_object('ok', true,
    'message', '비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.');
end $fn$;

-- 신규/변경 함수 권한 재적용
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

select 'm4 ok' as step;

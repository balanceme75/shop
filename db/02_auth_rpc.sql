-- =====================================================================
-- 초록마트 : [2/3] 회원 인증 RPC  (모두 public 스키마 / SECURITY DEFINER)
-- =====================================================================

-- ---------- 아이디 중복 확인 ----------
create or replace function public.auth_check_username(p_username text)
returns jsonb language plpgsql security definer
set search_path = app, public, extensions, pg_temp as $fn$
declare v_bad text; v_u text := app.norm_username(p_username);
begin
  v_bad := app.bad_username(p_username);
  if v_bad is not null then
    return jsonb_build_object('ok', true, 'available', false, 'error', v_bad);
  end if;
  if exists (select 1 from app.users where username = v_u) then
    return jsonb_build_object('ok', true, 'available', false,
                              'error', '이미 사용 중인 아이디입니다.');
  end if;
  return jsonb_build_object('ok', true, 'available', true, 'username', v_u,
                            'message', '사용 가능한 아이디입니다.');
end $fn$;

-- ---------- 회원가입 (아이디 + 비번 + 생년월일 + 휴대폰) ----------
create or replace function public.auth_signup(
  p_username  text,
  p_password  text,
  p_birthdate date,
  p_phone     text
) returns jsonb language plpgsql security definer
set search_path = app, public, extensions, pg_temp as $fn$
declare
  v_u text := app.norm_username(p_username);
  v_p text := app.norm_phone(p_phone);
  v_bad text;
  v_id uuid;
  v_token uuid;
begin
  v_bad := coalesce(app.bad_username(p_username), app.bad_password(p_password),
                    app.bad_birthdate(p_birthdate), app.bad_phone(p_phone));
  if v_bad is not null then return app.err(v_bad); end if;

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
    'message', '회원가입이 완료되었습니다.');
exception
  when unique_violation then return app.err('이미 사용 중인 아이디입니다.');
end $fn$;

-- ---------- 로그인 ----------
create or replace function public.auth_login(p_username text, p_password text)
returns jsonb language plpgsql security definer
set search_path = app, public, extensions, pg_temp as $fn$
declare r app.users; v_token uuid; v_min int;
begin
  select * into r from app.users where username = app.norm_username(p_username);
  if not found then
    return app.err('아이디 또는 비밀번호가 올바르지 않습니다.');
  end if;

  if r.locked_until is not null and r.locked_until > now() then
    v_min := greatest(1, ceil(extract(epoch from (r.locked_until - now())) / 60)::int);
    return app.err('로그인 시도가 너무 많습니다. ' || v_min || '분 후 다시 시도해 주세요.');
  end if;

  if r.password_hash <> extensions.crypt(p_password, r.password_hash) then
    update app.users
       set failed_count = failed_count + 1,
           locked_until = case when failed_count + 1 >= 10
                               then now() + interval '10 minutes' else null end,
           updated_at   = now()
     where id = r.id;
    return app.err('아이디 또는 비밀번호가 올바르지 않습니다.');
  end if;

  update app.users set failed_count = 0, locked_until = null, updated_at = now()
   where id = r.id;

  delete from app.sessions where expires_at < now();        -- 만료 세션 청소
  insert into app.sessions (user_id) values (r.id) returning token into v_token;

  return jsonb_build_object(
    'ok', true, 'token', v_token,
    'user', jsonb_build_object('id', r.id, 'username', r.username),
    'message', r.username || '님, 환영합니다.');
end $fn$;

-- ---------- 로그아웃 ----------
create or replace function public.auth_logout(p_token uuid)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
begin
  delete from app.sessions where token = p_token;
  return jsonb_build_object('ok', true);
end $fn$;

-- ---------- 내 정보 (세션 복원용) ----------
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
      'phone_masked', left(r.phone, 3) || '-****-' || right(r.phone, 4),
      'created_at', r.created_at),
    'cart_count', v_cnt);
end $fn$;

-- ---------- 아이디 찾기 (생년월일 + 휴대폰) ----------
create or replace function public.auth_find_id(p_birthdate date, p_phone text)
returns jsonb language plpgsql security definer
set search_path = app, public, pg_temp as $fn$
declare v_bad text; v_list jsonb;
begin
  v_bad := coalesce(app.bad_birthdate(p_birthdate), app.bad_phone(p_phone));
  if v_bad is not null then return app.err(v_bad); end if;

  select jsonb_agg(jsonb_build_object(
           'username', username,
           'created_at', created_at) order by created_at)
    into v_list
    from app.users
   where birthdate = p_birthdate and phone = app.norm_phone(p_phone);

  if v_list is null then
    return app.err('입력한 정보와 일치하는 회원이 없습니다.');
  end if;
  return jsonb_build_object('ok', true, 'accounts', v_list);
end $fn$;

-- ---------- 비밀번호 재설정 (아이디 + 생년월일 + 휴대폰) ----------
create or replace function public.auth_reset_password(
  p_username     text,
  p_birthdate    date,
  p_phone        text,
  p_new_password text
) returns jsonb language plpgsql security definer
set search_path = app, public, extensions, pg_temp as $fn$
declare v_bad text; v_id uuid;
begin
  v_bad := coalesce(app.bad_username(p_username), app.bad_birthdate(p_birthdate),
                    app.bad_phone(p_phone), app.bad_password(p_new_password));
  if v_bad is not null then return app.err(v_bad); end if;

  select id into v_id from app.users
   where username  = app.norm_username(p_username)
     and birthdate = p_birthdate
     and phone     = app.norm_phone(p_phone);

  if v_id is null then
    return app.err('입력한 정보와 일치하는 회원이 없습니다.');
  end if;

  update app.users
     set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
         failed_count  = 0, locked_until = null, updated_at = now()
   where id = v_id;

  delete from app.sessions where user_id = v_id;   -- 보안상 전체 로그아웃

  return jsonb_build_object('ok', true,
    'message', '비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.');
end $fn$;

-- ---------- 비밀번호 변경 (로그인 상태) ----------
create or replace function public.auth_change_password(
  p_token            uuid,
  p_current_password text,
  p_new_password     text
) returns jsonb language plpgsql security definer
set search_path = app, public, extensions, pg_temp as $fn$
declare v_uid uuid; r app.users; v_bad text; v_token uuid;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;

  v_bad := app.bad_password(p_new_password);
  if v_bad is not null then return app.err(v_bad); end if;

  select * into r from app.users where id = v_uid;
  if r.password_hash <> extensions.crypt(p_current_password, r.password_hash) then
    return app.err('현재 비밀번호가 올바르지 않습니다.');
  end if;
  if extensions.crypt(p_new_password, r.password_hash) = r.password_hash then
    return app.err('현재 비밀번호와 다른 비밀번호를 입력해 주세요.');
  end if;

  update app.users
     set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = v_uid;

  delete from app.sessions where user_id = v_uid;   -- 다른 기기 세션 종료
  insert into app.sessions (user_id) values (v_uid) returning token into v_token;

  return jsonb_build_object('ok', true, 'token', v_token,
    'message', '비밀번호가 변경되었습니다.');
end $fn$;

-- ---------- 아이디 변경 (로그인 상태 + 비번 확인) ----------
create or replace function public.auth_change_username(
  p_token        uuid,
  p_password     text,
  p_new_username text
) returns jsonb language plpgsql security definer
set search_path = app, public, extensions, pg_temp as $fn$
declare v_uid uuid; r app.users; v_bad text; v_u text := app.norm_username(p_new_username);
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;

  v_bad := app.bad_username(p_new_username);
  if v_bad is not null then return app.err(v_bad); end if;

  select * into r from app.users where id = v_uid;
  if r.password_hash <> extensions.crypt(p_password, r.password_hash) then
    return app.err('비밀번호가 올바르지 않습니다.');
  end if;
  if r.username = v_u then
    return app.err('현재 아이디와 동일합니다.');
  end if;
  if exists (select 1 from app.users where username = v_u) then
    return app.err('이미 사용 중인 아이디입니다.');
  end if;

  update app.users set username = v_u, updated_at = now() where id = v_uid;

  return jsonb_build_object('ok', true,
    'user', jsonb_build_object('id', v_uid, 'username', v_u),
    'message', '아이디가 ' || v_u || ' 로 변경되었습니다.');
exception
  when unique_violation then return app.err('이미 사용 중인 아이디입니다.');
end $fn$;

-- ---------- 생년월일/휴대폰(복구 정보) 변경 ----------
create or replace function public.auth_update_recovery(
  p_token     uuid,
  p_password  text,
  p_birthdate date,
  p_phone     text
) returns jsonb language plpgsql security definer
set search_path = app, public, extensions, pg_temp as $fn$
declare v_uid uuid; r app.users; v_bad text;
begin
  v_uid := app.uid_of(p_token);
  if v_uid is null then return app.err('로그인이 필요합니다.'); end if;

  v_bad := coalesce(app.bad_birthdate(p_birthdate), app.bad_phone(p_phone));
  if v_bad is not null then return app.err(v_bad); end if;

  select * into r from app.users where id = v_uid;
  if r.password_hash <> extensions.crypt(p_password, r.password_hash) then
    return app.err('비밀번호가 올바르지 않습니다.');
  end if;

  update app.users
     set birthdate = p_birthdate, phone = app.norm_phone(p_phone), updated_at = now()
   where id = v_uid;

  return jsonb_build_object('ok', true, 'message', '회원 정보가 수정되었습니다.');
end $fn$;

select 'm2 ok' as step;

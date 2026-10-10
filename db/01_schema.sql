-- =====================================================================
-- 초록마트 : 회원(아이디/비번) + 계정별 장바구니  [1/3] 스키마
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

-- 회원 데이터는 PostgREST 에 노출되지 않는 app 스키마에 보관한다.
-- (public 만 노출되므로 anon 키로는 테이블을 직접 조회/수정할 수 없음)
create schema if not exists app;
revoke all on schema app from anon, authenticated;

-- ---------- 회원 ----------
create table if not exists app.users (
  id            uuid        primary key default gen_random_uuid(),
  username      text        not null unique,          -- 소문자 정규화 저장
  password_hash text        not null,                 -- bcrypt
  birthdate     date        not null,                 -- 아이디/비번 찾기용
  phone         text        not null,                 -- 숫자만 정규화 저장
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  failed_count  int         not null default 0,       -- 로그인 실패 횟수
  locked_until  timestamptz                           -- 잠금 해제 시각
);
create index if not exists users_recovery_idx on app.users (birthdate, phone);

-- ---------- 로그인 세션 ----------
create table if not exists app.sessions (
  token      uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references app.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);
create index if not exists sessions_user_idx    on app.sessions (user_id);
create index if not exists sessions_expires_idx on app.sessions (expires_at);

-- ---------- 계정별 장바구니 ----------
create table if not exists app.cart_items (
  user_id    uuid        not null references app.users(id)      on delete cascade,
  product_id int         not null references public.products(id) on delete cascade,
  qty        int         not null default 1 check (qty > 0 and qty <= 99),
  added_at   timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
create index if not exists cart_user_idx on app.cart_items (user_id);

-- ---------- 공통 헬퍼 ----------
create or replace function app.norm_username(p text)
returns text language sql immutable as $fn$
  select lower(btrim(coalesce(p, '')))
$fn$;

create or replace function app.norm_phone(p text)
returns text language sql immutable as $fn$
  select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g')
$fn$;

-- 유효한 세션 토큰 -> user_id (만료/위조 토큰은 null)
create or replace function app.uid_of(p_token uuid)
returns uuid language sql security definer set search_path = app, pg_temp as $fn$
  select user_id from app.sessions where token = p_token and expires_at > now()
$fn$;

create or replace function app.err(p_msg text)
returns jsonb language sql immutable as $fn$
  select jsonb_build_object('ok', false, 'error', p_msg)
$fn$;

-- 아이디 규칙 검사
create or replace function app.bad_username(p text)
returns text language sql immutable as $fn$
  select case
    when app.norm_username(p) !~ '^[a-z0-9_]{4,20}$'
      then '아이디는 영문 소문자·숫자·밑줄(_) 4~20자로 입력해 주세요.'
    else null end
$fn$;

-- 비밀번호 규칙 검사
create or replace function app.bad_password(p text)
returns text language sql immutable as $fn$
  select case
    when length(coalesce(p, '')) < 6  then '비밀번호는 6자 이상으로 입력해 주세요.'
    when length(coalesce(p, '')) > 72 then '비밀번호는 72자 이하로 입력해 주세요.'
    else null end
$fn$;

-- 생년월일 / 휴대폰 검사
create or replace function app.bad_birthdate(p date)
returns text language sql stable as $fn$
  select case
    when p is null or p < date '1900-01-01' or p > current_date
      then '생년월일을 정확히 입력해 주세요.'
    else null end
$fn$;

create or replace function app.bad_phone(p text)
returns text language sql immutable as $fn$
  select case
    when app.norm_phone(p) !~ '^01[0-9]{7,9}$'
      then '휴대폰 번호를 정확히 입력해 주세요. (예: 010-1234-5678)'
    else null end
$fn$;

select 'm1 ok' as step;

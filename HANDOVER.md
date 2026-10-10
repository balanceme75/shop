# 초록마트 쇼핑몰 — 인수인계 문서

## 프로젝트 개요
- **쇼핑몰 이름**: 초록마트
- **콘셉트**: 화분·분재·씨앗 전문 온라인 쇼핑몰, 녹색 편안한 분위기
- **타겟**: 30대~60대
- **로컬 포트**: 9000 (`serve.ps1` / PowerShell HTTP 서버)
- **라이브**: https://balanceme75.github.io/shop/

---

## 파일 위치

| 구분 | 경로 |
|------|------|
| 작업 폴더 (단일 소스 = GitHub 레포) | `D:\AsTecPro\astec-shop\` |
| 환경변수 | `D:\AsTecPro\astec-shop\.env` |

### 소스 파일 구성
```
D:\AsTecPro\astec-shop\      ← 작업 폴더 겸 GitHub 레포 (main 브랜치)
├── index.html   ← 메인 HTML (상품 + 회원 모달 + 장바구니 패널)
├── style.css    ← 녹색 테마 CSS
├── script.js    ← Supabase 연동 JS (상품 / 회원 / 장바구니)
├── serve.ps1    ← 로컬 미리보기 서버 (PowerShell)
├── db\          ← Supabase 스키마 마이그레이션 SQL (적용 완료본)
│   ├── 01_schema.sql         ← app 스키마 + users/sessions/cart_items 테이블
│   ├── 02_auth_rpc.sql       ← 회원 인증 RPC
│   ├── 03_cart_rpc.sql       ← 장바구니 RPC + 권한
│   └── 04_minimal_signup.sql ← 가입 최소화(아이디+비번만) 반영
├── HANDOVER.md  ← 이 문서
├── .gitignore   ← .env 제외
└── .env         ← 토큰 보관 (GitHub 미포함)
```

> 작업 폴더와 GitHub 레포가 같은 폴더입니다. 별도 복사 단계 없이 여기서 바로 커밋/푸시합니다.
> 구버전 폴더 `C:\Users\balan\chorok-mart\public\`는 2026-10-10 삭제했습니다.

---

## GitHub 레포
- **URL**: https://github.com/balanceme75/shop
- **브랜치**: `main`
- **GitHub Pages**: ✅ 활성화 완료 (2026-10-10, Deploy from a branch / `main` / `(root)`)
- **Pages URL(라이브)**: https://balanceme75.github.io/shop/
- 변경사항은 `main` 에 푸시하면 1~2분 뒤 자동 재배포됩니다.

---

## Supabase DB 연동

### 접속 정보

> 🔐 **실제 값은 이 문서에 적지 않습니다.** 로컬 `.env` 파일에만 보관하며
> `.gitignore` 로 GitHub 에서 제외됩니다. 양식은 `.env.example` 참고.

| 키 | 성격 | 보관 위치 |
|----|------|-----------|
| `SUPABASE_URL` | 공개 (브라우저가 호출하는 주소) | `.env` + `script.js` |
| `SUPABASE_ANON_KEY` | 공개 (publishable 키) | `.env` + `script.js` |
| `SUPABASE_PROJECT_REF` | 공개 (URL 에 포함됨) | `.env` |
| `SUPABASE_PAT` | **절대 비공개** (프로젝트 관리자 권한) | **`.env` 에만** |

**`SUPABASE_PAT` 취급 규칙**
- 소스 코드·문서·커밋에 **절대 넣지 않습니다.**
- 용도는 로컬에서 스키마를 변경할 때(Management API / SQL 실행)뿐입니다.
- 노출이 의심되면 즉시 폐기·재발급: https://supabase.com/dashboard/account/tokens

**`SUPABASE_ANON_KEY` 가 `script.js` 에 들어있는 이유**
정적 사이트는 브라우저가 직접 Supabase 를 호출하므로 anon 키는 **공개될 수밖에 없고,
원래 공개용(publishable)으로 설계된 키**입니다. 숨겨서 지키는 값이 아닙니다.
실제 보안은 다음으로 확보합니다.
- 회원 테이블을 PostgREST 비노출 `app` 스키마에 격리 (anon 키로 직접 접근 불가)
- 모든 접근을 `SECURITY DEFINER` RPC 함수로만 통과
- 비밀번호 bcrypt 해시, 세션 토큰 검증, 로그인 실패 잠금
- `products` 테이블만 RLS `public_read` 로 공개

### DB 테이블: `products`
```sql
CREATE TABLE products (
  id          INT PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,   -- '흙' | '화분' | '씨앗'
  price       INT  NOT NULL,   -- 정가
  discount    INT  NOT NULL DEFAULT 0,  -- 할인율(%)
  description TEXT,
  img         TEXT,            -- Unsplash URL
  badge       TEXT             -- '베스트'|'인기'|'신상'|'추천'|NULL
);
```

### 현재 등록된 상품 (8개)
| id | 상품명 | 카테고리 | 정가 | 할인 | 뱃지 |
|----|--------|----------|------|------|------|
| 1 | 프리미엄 배양토 | 흙 | 10,000원 | 20% | 베스트 |
| 2 | 다육이 전용 흙 | 흙 | 10,000원 | 10% | - |
| 3 | 미니 테라코타 화분 | 화분 | 6,000원 | 15% | 인기 |
| 4 | 미니 세라믹 화분 | 화분 | 6,000원 | 5% | - |
| 5 | 미니 분재 화분 | 화분 | 6,000원 | 30% | 신상 |
| 6 | 바질 씨앗 | 씨앗 | 3,000원 | 10% | 추천 |
| 7 | 방울토마토 씨앗 | 씨앗 | 3,000원 | 15% | - |
| 8 | 라벤더 씨앗 | 씨앗 | 3,000원 | 20% | 인기 |

### RLS 정책
- `public_read`: 누구나 SELECT 가능
- INSERT/UPDATE/DELETE: PAT(Management API)로만 가능

---

## 회원 + 장바구니 DB (2026-10-10 추가)

### 설계 요약
- **Supabase Auth 를 쓰지 않고 자체 인증**을 구현했습니다.
  이유: Supabase Auth 는 이메일이 필수인데, 요구사항은 **아이디+비밀번호만**이고
  아이디/비번 분실 복구를 **생년월일+휴대폰**으로 서버에서 검증해야 하기 때문입니다.
- 회원 데이터는 **`app` 스키마**에 두었습니다. PostgREST 는 `public` 만 노출하므로
  **anon 키로는 회원 테이블을 직접 조회·수정할 수 없습니다.**
  모든 접근은 `public` 스키마의 `SECURITY DEFINER` RPC 함수만 통과합니다.
- 비밀번호는 **pgcrypto bcrypt(`crypt` + `gen_salt('bf',10)`)** 로 해시 저장.
  평문은 어디에도 저장되지 않습니다.
- 로그인 실패 10회 시 10분 잠금. 세션 토큰 유효기간 30일.

### 테이블 (`app` 스키마)
```sql
app.users       -- id, username(고유·소문자정규화), password_hash(bcrypt),
                -- birthdate, phone(숫자만), created_at, updated_at,
                -- failed_count, locked_until
app.sessions    -- token(uuid, PK), user_id, created_at, expires_at(+30일)
app.cart_items  -- (user_id, product_id) PK, qty(1~99), added_at, updated_at
```

### 가입 정책 — 정보 최소화
| 항목 | 필수 여부 |
|------|-----------|
| 아이디 (영문 소문자·숫자·밑줄 4~20자) | **필수** |
| 비밀번호 (6~72자) | **필수** |
| 생년월일 + 휴대폰 | **선택** (분실 복구용, 가입 직후 또는 내 정보에서 등록) |

이름·이메일·주소는 **수집하지 않습니다.**
생년월일/휴대폰은 둘 다 입력하거나 둘 다 비워야 합니다(한쪽만 입력 불가).
복구 정보를 등록하지 않은 계정은 아이디 찾기·비번 재설정이 **불가**합니다.

### RPC 함수 목록 (anon 키로 호출 가능)
| 함수 | 용도 |
|------|------|
| `auth_check_username(p_username)` | 아이디 중복·규칙 확인 (입력 중 실시간) |
| `auth_signup(p_username, p_password [, p_birthdate, p_phone])` | 회원가입 → 토큰 발급 |
| `auth_login(p_username, p_password)` | 로그인 → 토큰 발급 |
| `auth_logout(p_token)` | 세션 삭제 |
| `auth_me(p_token)` | 내 정보 + 장바구니 수량 (세션 복원용) |
| `auth_find_id(p_birthdate, p_phone)` | **아이디 찾기** |
| `auth_reset_password(p_username, p_birthdate, p_phone, p_new_password)` | **비번 분실 재설정** |
| `auth_change_password(p_token, p_current_password, p_new_password)` | 비번 변경 (로그인 상태) |
| `auth_change_username(p_token, p_password, p_new_username)` | **아이디 변경** |
| `auth_update_recovery(p_token, p_password, p_birthdate, p_phone)` | 복구 정보 등록·수정 |
| `cart_get(p_token)` | 장바구니 조회 (상품 조인 + 할인가 계산) |
| `cart_add(p_token, p_product_id, p_qty)` | 담기 (중복 시 수량 누적) |
| `cart_set_qty(p_token, p_product_id, p_qty)` | 수량 지정 (0 이하 → 삭제) |
| `cart_remove(p_token, p_product_id)` | 개별 삭제 |
| `cart_clear(p_token)` | 전체 비우기 |
| `cart_merge(p_token, p_items)` | 비로그인 장바구니를 계정으로 병합 |

모든 함수는 `{ "ok": true, ... }` 또는 `{ "ok": false, "error": "한글 메시지" }` 를 반환합니다.

### 장바구니 저장 방식
- **로그인 상태**: 담기/수량변경/삭제가 즉시 `app.cart_items` 에 반영됩니다.
  로그아웃 후 다시 로그인하거나 **다른 기기에서 로그인해도 그대로 유지**됩니다.
- **비로그인 상태**: 브라우저 `localStorage`(`chorok.guestCart`)에 임시 보관하고,
  로그인·가입하는 순간 `cart_merge` 로 계정 장바구니에 **합산 병합**한 뒤 삭제합니다.
- 세션 토큰은 `localStorage`(`chorok.token`)에 보관하여 새로고침 시 로그인 상태를 복원합니다.

### 스키마 재적용 방법
`db\01~04` 를 번호 순서대로 Supabase SQL Editor 에 붙여 실행하면 됩니다.
(모두 `create or replace` / `if not exists` 라서 재실행해도 안전합니다.)

---

## 구현된 주요 기능

### 프론트엔드
- **헤더**: 고정 녹색 헤더, 로고, 내비게이션, **회원 영역(로그인·회원가입 / 아이디·로그아웃)**, 장바구니 버튼
- **회원 모달 6화면**: 로그인 / 회원가입 / 복구정보 등록 / 아이디 찾기 / 비밀번호 재설정 / 내 정보
  - 회원가입: 아이디 실시간 중복확인, 비밀번호 확인 일치 검사
  - 내 정보: 비밀번호 변경 · 아이디 변경 · 복구 정보 탭
  - 제출 중 버튼 잠금, 성공/실패 메시지 인라인 표시, ESC 로 닫기
- **히어로 배너**: 전체 화면 녹색 그라디언트 + 식물 이미지
- **카테고리 카드 3개**: 화분(녹색), 씨앗(앰버), 흙(갈색) — 각각 다른 색상
- **상품 그리드**: Supabase DB에서 동적 로드, 카테고리 필터
- **상품 카드**: 이미지, 뱃지(베스트=빨강, 그 외=녹색), 할인율(-XX%), 정가(취소선) + 할인가
- **장바구니 사이드 패널**: 수량 조절, 제거, 합계, 주문하기
  - 로그인 시 "☁️ (아이디) 계정에 저장 중" 표시 → **계정별 DB 저장**
  - 비로그인 시 "로그인하면 계정에 저장됩니다" 안내 + 로그인 버튼
- **소개 섹션 (about)**: 무료배송·당일발송·안심포장 카드 + 배양토·화분·씨앗 품질 설명
- **문의 폼**: 이름·연락처·내용 입력 후 접수
- **푸터**: 로고, 링크, 고객센터 정보
- **토스트 알림**: 장바구니 담기 시 하단 알림

### Supabase 연동 (script.js)
```javascript
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 비동기 상품 로드
const { data } = await db.from('products').select('*').order('id');
// DB의 description → JS의 desc 로 매핑
```

---

## 로컬 서버 실행 방법

> ⚠️ 이 PC 에는 **Python 이 설치되어 있지 않습니다.**
> `python` 은 Microsoft Store 설치 안내만 띄우는 더미(앱 실행 별칭)이므로
> `python -m http.server` 가 동작하지 않습니다. 대신 `serve.ps1` 을 사용하세요.

```powershell
# PowerShell 에서 (포트 9000)
cd D:\AsTecPro\astec-shop
powershell -ExecutionPolicy Bypass -File serve.ps1

# 브라우저: http://localhost:9000
# 종료: Ctrl + C
```

- 포트를 바꾸려면: `... -File serve.ps1 -Port 8080`
- `serve.ps1` 은 `.env` / `.git` 요청을 404 로 차단합니다.
- **파일 인코딩 주의**: `serve.ps1` 은 한글 주석이 있어 **UTF-8 BOM** 으로 저장되어야 합니다.
  (Windows PowerShell 5.1 은 BOM 없는 UTF-8 을 ANSI 로 읽어 파싱 오류가 납니다.)

---

## GitHub 배포 방법
```bash
# 작업 폴더가 곧 GitHub 레포이므로 복사 단계 없음
cd D:\AsTecPro\astec-shop
git add index.html style.css script.js
git commit -m "업데이트 내용"
git push origin main
```

---

## 향후 작업 제안 (미완성 항목)
- [x] ~~장바구니 저장 (새로고침 시 유지)~~ → **계정별 Supabase DB 저장으로 완료**
- [x] ~~회원가입 / 로그인~~ → **완료 (아이디+비번, 분실 복구 포함)**
- [ ] 라벤더 씨앗 이미지 교체 (현재 아보카도 이미지 오염 가능성 있음)
- [x] ~~GitHub Pages 활성화~~ → **완료, https://balanceme75.github.io/shop/ 배포 중**
- [ ] **주문 기능 실제 구현** (현재는 alert 처리. `app.orders` / `app.order_items` 테이블 추가 필요)
- [ ] 상품 관리자 페이지 (Supabase에서 상품 추가/수정/삭제)
- [ ] 문의 폼 DB 저장 (현재는 토스트만 표시, 실제 저장 안 됨)
- [ ] 반응형 모바일 UI 실기기 점검
- [ ] 회원 탈퇴 기능 (`app.users` 삭제 시 세션·장바구니는 CASCADE 로 함께 삭제됨)

---

## Supabase 대시보드 링크
- **Table Editor**: https://supabase.com/dashboard/project/zfpybmwebncpjydfebkn/editor
- **SQL Editor**: https://supabase.com/dashboard/project/zfpybmwebncpjydfebkn/sql/new
- **API Settings**: https://supabase.com/dashboard/project/zfpybmwebncpjydfebkn/settings/api
- **Access Tokens**: https://supabase.com/dashboard/account/tokens

---

## 작업 이력 요약
1. 초록마트 HTML/CSS/JS 쇼핑몰 최초 생성 (포트 9000)
2. Unsplash 무료 이미지 적용 (픽셀 색상 분석으로 검증)
3. 상품 할인율 표시 (정가 취소선 + 할인가 + 우측 -%표시)
4. 베스트 뱃지 빨간색 처리
5. 카테고리 카드 색상 차별화 (녹색/앰버/갈색)
6. 초록마트 소개 섹션 강화 (무료배송·당일발송·안심포장 + 품질 카드)
7. Supabase DB 연동: products 테이블 생성, 8개 상품 삽입, RLS 설정
8. GitHub 레포(balanceme75/shop) 생성 및 코드 푸시
9. 한글 깨짐 수정: Python UTF-8로 재삽입
10. `.env` 파일로 토큰 보관, `.gitignore`로 GitHub 제외 처리
11. (2026-10-10) 작업 폴더를 `D:\AsTecPro\astec-shop\`으로 이전. `.git`을 함께 옮겨
    GitHub 레포(balanceme75/shop, `main`) 연결 유지. 이전 문서의 "`public\` → `shop\` 복사"
    배포 절차는 최신 Supabase 연동을 구버전으로 덮어쓰므로 폐기함
12. (2026-10-10) 구버전 폴더 `C:\Users\balan\chorok-mart\` 삭제
13. (2026-10-10) **회원 기능 + 계정별 장바구니 전체 구현 (모두 Supabase DB 저장)**
    - `app` 스키마에 `users` / `sessions` / `cart_items` 테이블 생성 (PostgREST 비노출)
    - bcrypt(pgcrypto) 비밀번호 해시, 로그인 10회 실패 시 10분 잠금, 세션 30일
    - `SECURITY DEFINER` RPC 16개 생성 (`auth_*` 10개 + `cart_*` 6개), anon 전용 실행 권한
    - 가입 최소화: 아이디+비밀번호만 필수 / 생년월일·휴대폰은 분실 복구용 선택
    - 아이디 찾기 · 비밀번호 재설정 · 아이디 변경 · 비밀번호 변경 · 복구정보 수정
    - 장바구니: 로그인 시 DB 저장(기기 간 유지), 비로그인분은 로그인 시 자동 병합
    - anon 키로 회원 테이블 직접 접근 차단 확인 (`Invalid schema: app`)
    - `db\01~04.sql` 로 마이그레이션 보관
14. (2026-10-10) `serve.ps1` 추가 — 이 PC 의 `python` 이 Store 더미라 동작하지 않아
    PowerShell HttpListener 기반 로컬 서버로 대체
15. (2026-10-10) 비밀값 분리: HANDOVER.md 에서 PAT·anon 키 실제 값 제거 → `.env` 전용 보관,
    `.gitignore` 전면 정비(키·토큰·로그·임시파일), `.env.example` 양식 추가
16. (2026-10-10) GitHub Pages 활성화 (GitHub API, `main` / root) → 라이브 배포 및 동작 확인

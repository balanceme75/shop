// =====================================================================
// 초록마트 — Supabase 연동 (상품 / 회원 / 계정별 장바구니)
// =====================================================================
const SUPABASE_URL = 'https://zfpybmwebncpjydfebkn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_gYpLXW6pRTo5AzuHw4jU0Q_ve8Y4Ga1';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const TOKEN_KEY = 'chorok.token';       // 로그인 세션 토큰
const GUEST_KEY = 'chorok.guestCart';   // 비로그인 임시 장바구니

// ===== 상태 =====
let allProducts = [];
let cart = [];            // [{ product_id, name, img, price, discount, sale_price, qty }]
let currentFilter = '전체';
let currentUser = null;   // 로그인한 회원 정보 (null = 비로그인)
let pendingPassword = null; // 가입 직후 복구정보 등록에만 잠시 사용

// ===== 공통 유틸 =====
const $ = id => document.getElementById(id);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const token = {
  get:   () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set:   v  => { try { localStorage.setItem(TOKEN_KEY, v); } catch {} },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch {} },
};

const guestCart = {
  get() {
    try { const v = JSON.parse(localStorage.getItem(GUEST_KEY) || '[]'); return Array.isArray(v) ? v : []; }
    catch { return []; }
  },
  set(items) { try { localStorage.setItem(GUEST_KEY, JSON.stringify(items)); } catch {} },
  clear()    { try { localStorage.removeItem(GUEST_KEY); } catch {} },
};

// Supabase RPC 호출 (DB 함수는 모두 { ok, ... } 형태를 반환)
async function rpc(fn, args = {}) {
  try {
    const { data, error } = await db.rpc(fn, args);
    if (error) {
      console.error(`RPC ${fn} 오류:`, error.message);
      return { ok: false, error: '서버와 통신할 수 없습니다. 잠시 후 다시 시도해 주세요.' };
    }
    return data || { ok: false, error: '응답을 받지 못했습니다.' };
  } catch (e) {
    console.error(`RPC ${fn} 예외:`, e);
    return { ok: false, error: '네트워크 오류가 발생했습니다.' };
  }
}

// =====================================================================
// 상품
// =====================================================================
async function fetchProducts() {
  const { data, error } = await db.from('products').select('*').order('id');
  if (error) {
    console.error('상품 로딩 오류:', error.message);
    showToast('상품을 불러오는 중 오류가 발생했습니다.');
    return [];
  }
  return data.map(p => ({ ...p, desc: p.description }));
}

function getSalePrice(p) {
  return Math.round(p.price * (1 - p.discount / 100));
}

function renderProducts(filter) {
  const grid = $('productsGrid');
  const filtered = filter === '전체'
    ? allProducts
    : allProducts.filter(p => p.category === filter);

  if (filtered.length === 0) {
    grid.innerHTML = '<p style="text-align:center;color:#757575;padding:40px 0">상품을 불러오는 중...</p>';
    return;
  }

  grid.innerHTML = filtered.map(p => {
    const salePrice = getSalePrice(p);
    const isBest = p.badge === '베스트';
    return `
    <div class="product-card" data-id="${p.id}">
      <div class="product-img">
        <img src="${esc(p.img)}" alt="${esc(p.name)}" loading="lazy" />
        ${p.badge ? `<span class="product-badge${isBest ? ' badge-best' : ''}">${esc(p.badge)}</span>` : ''}
        <span class="product-discount-badge">-${p.discount}%</span>
      </div>
      <div class="product-info">
        <div class="product-category">${esc(p.category)}</div>
        <div class="product-name">${esc(p.name)}</div>
        <div class="product-desc">${esc(p.desc || '')}</div>
        <div class="product-bottom">
          <div class="price-group">
            <span class="product-original-price">${p.price.toLocaleString()}원</span>
            <div class="price-row">
              <span class="product-price">${salePrice.toLocaleString()}원</span>
              <span class="product-discount-rate">-${p.discount}%</span>
            </div>
          </div>
          <button class="add-btn" onclick="addToCart(${p.id})">담기</button>
        </div>
      </div>
    </div>
  `;
  }).join('');
}

function filterProducts(filter) {
  currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.includes(
      filter === '전체' ? '전체' :
      filter === '화분' ? '화분' :
      filter === '씨앗' ? '씨앗' : '흙'
    ));
  });
  renderProducts(filter);
  if (filter !== '전체') $('products').scrollIntoView({ behavior: 'smooth' });
}

// =====================================================================
// 장바구니  — 로그인 시 Supabase(app.cart_items)에 계정별로 저장
//            비로그인 시에는 브라우저에만 임시 보관 후 로그인 시 DB로 병합
// =====================================================================

// DB 응답({ items: [...] })을 화면 상태로 반영
function applyCartPayload(res) {
  if (!res.ok) { showToast(res.error); return false; }
  cart = res.items || [];
  updateCartUI();
  return true;
}

// 비로그인 장바구니를 상품 정보와 합쳐 화면 상태로 변환
function buildGuestCart() {
  cart = guestCart.get()
    .map(({ product_id, qty }) => {
      const p = allProducts.find(x => x.id === product_id);
      if (!p) return null;
      const sale = getSalePrice(p);
      return {
        product_id: p.id, name: p.name, img: p.img, category: p.category,
        price: p.price, discount: p.discount, sale_price: sale,
        qty, line_total: sale * qty,
      };
    })
    .filter(Boolean);
  updateCartUI();
}

async function loadCart() {
  if (currentUser) {
    applyCartPayload(await rpc('cart_get', { p_token: token.get() }));
  } else {
    buildGuestCart();
  }
}

async function addToCart(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;

  if (currentUser) {
    const res = await rpc('cart_add', {
      p_token: token.get(), p_product_id: productId, p_qty: 1,
    });
    if (res.ok === false && res.error === '로그인이 필요합니다.') return handleSessionExpired();
    if (!applyCartPayload(res)) return;
    showToast(`"${product.name}"을(를) 장바구니에 담았습니다. (계정 저장됨)`);
  } else {
    const items = guestCart.get();
    const found = items.find(i => i.product_id === productId);
    if (found) found.qty = Math.min(99, found.qty + 1);
    else items.push({ product_id: productId, qty: 1 });
    guestCart.set(items);
    buildGuestCart();
    showToast(`"${product.name}"을(를) 장바구니에 담았습니다.`);
  }
}

async function changeQty(productId, delta) {
  const item = cart.find(i => i.product_id === productId);
  if (!item) return;
  const next = item.qty + delta;

  if (currentUser) {
    const res = await rpc('cart_set_qty', {
      p_token: token.get(), p_product_id: productId, p_qty: next,
    });
    if (res.ok === false && res.error === '로그인이 필요합니다.') return handleSessionExpired();
    applyCartPayload(res);
  } else {
    let items = guestCart.get();
    if (next <= 0) items = items.filter(i => i.product_id !== productId);
    else items = items.map(i => i.product_id === productId ? { ...i, qty: Math.min(99, next) } : i);
    guestCart.set(items);
    buildGuestCart();
  }
}

async function removeFromCart(productId) {
  if (currentUser) {
    const res = await rpc('cart_remove', { p_token: token.get(), p_product_id: productId });
    if (res.ok === false && res.error === '로그인이 필요합니다.') return handleSessionExpired();
    applyCartPayload(res);
  } else {
    guestCart.set(guestCart.get().filter(i => i.product_id !== productId));
    buildGuestCart();
  }
}

function updateCartUI() {
  const totalQty   = cart.reduce((s, i) => s + i.qty, 0);
  const totalPrice = cart.reduce((s, i) => s + i.sale_price * i.qty, 0);

  $('cartCount').textContent = totalQty;
  $('cartTotal').textContent = totalPrice.toLocaleString();

  // 계정 저장 안내 / 동기화 표시
  $('cartNotice').hidden = !!currentUser;
  $('cartSync').hidden   = !currentUser;
  if (currentUser) $('cartSyncUser').textContent = currentUser.username;

  const box = $('cartItems');
  if (cart.length === 0) {
    box.innerHTML = '<p class="cart-empty">장바구니가 비어 있습니다.</p>';
    return;
  }

  box.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="cart-item-img">
        <img src="${esc(item.img)}" alt="${esc(item.name)}" />
      </div>
      <div class="cart-item-info">
        <div class="cart-item-name">${esc(item.name)}</div>
        <div class="cart-item-price">${(item.sale_price * item.qty).toLocaleString()}원
          <span class="cart-discount-rate">-${item.discount}%</span>
        </div>
      </div>
      <div class="cart-item-qty">
        <button class="qty-btn" onclick="changeQty(${item.product_id}, -1)">−</button>
        <span class="qty-num">${item.qty}</span>
        <button class="qty-btn" onclick="changeQty(${item.product_id}, 1)">+</button>
      </div>
      <button class="remove-btn" onclick="removeFromCart(${item.product_id})" title="제거">✕</button>
    </div>
  `).join('');
}

function toggleCart() {
  const panel   = $('cartPanel');
  const overlay = $('cartOverlay');
  panel.classList.toggle('open');
  overlay.classList.toggle('open');
  document.body.style.overflow = panel.classList.contains('open') ? 'hidden' : '';
}

async function placeOrder() {
  if (cart.length === 0) { showToast('장바구니가 비어 있습니다.'); return; }
  const total = cart.reduce((s, i) => s + i.sale_price * i.qty, 0);
  alert(`주문이 완료되었습니다!\n총 결제 금액: ${total.toLocaleString()}원\n\n초록마트를 이용해 주셔서 감사합니다. 🌿`);

  if (currentUser) {
    applyCartPayload(await rpc('cart_clear', { p_token: token.get() }));
  } else {
    guestCart.clear();
    buildGuestCart();
  }
  toggleCart();
}

// =====================================================================
// 회원 — 모달 제어
// =====================================================================
const VIEWS = {
  login:    { title: '로그인',          desc: '아이디와 비밀번호를 입력해 주세요.' },
  signup:   { title: '회원가입',        desc: '아이디와 비밀번호만으로 가입할 수 있습니다.' },
  recovery: { title: '분실 복구 정보',  desc: '아이디·비밀번호를 잊어버렸을 때 사용됩니다. (선택)' },
  findid:   { title: '아이디 찾기',     desc: '생년월일과 휴대폰 번호로 아이디를 찾습니다.' },
  reset:    { title: '비밀번호 재설정', desc: '본인 확인 후 새 비밀번호로 변경합니다.' },
  account:  { title: '내 정보',         desc: '아이디·비밀번호·복구 정보를 수정할 수 있습니다.' },
};

async function openModal(view) {
  if (view === 'account') {
    if (!currentUser) view = 'login';
    else if (!(await refreshMe())) view = 'login';   // 최신 정보로 갱신
  }
  switchView(view);
  $('modalOverlay').classList.add('open');
  $('authModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  $('modalOverlay').classList.remove('open');
  $('authModal').classList.remove('open');
  if (!$('cartPanel').classList.contains('open')) document.body.style.overflow = '';
  pendingPassword = null;
}

function switchView(view) {
  Object.keys(VIEWS).forEach(v => {
    const el = $('view-' + v);
    if (el) el.hidden = (v !== view);
  });
  $('modalTitle').textContent = VIEWS[view].title;
  $('modalDesc').textContent  = VIEWS[view].desc;
  clearMsg();
  if (view === 'account') renderAccount();

  const first = $('view-' + view)?.querySelector('input:not([type=hidden])');
  if (first) setTimeout(() => first.focus(), 80);
}

function showMsg(text, kind = 'error', html = false) {
  const el = $('modalMsg');
  if (html) el.innerHTML = text; else el.textContent = text;
  el.className = 'modal-msg ' + kind;
  el.hidden = false;
}

function clearMsg() {
  const el = $('modalMsg');
  el.hidden = true;
  el.textContent = '';
}

// 제출 중 버튼 잠금
async function withBusy(form, label, task) {
  const btn = form.querySelector('.auth-submit');
  const old = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = label; }
  try { return await task(); }
  finally { if (btn) { btn.disabled = false; btn.textContent = old; } }
}

// =====================================================================
// 회원 — 동작
// =====================================================================
function applySession(user) {
  // auth_login/auth_signup 은 id·username 만 주므로 기존 정보를 보존하며 병합
  currentUser = { ...(currentUser || {}), ...user };
  $('acctGuest').hidden = true;
  $('acctUser').hidden  = false;
  $('acctUsername').textContent = user.username;
}

function applyLoggedOut() {
  currentUser = null;
  $('acctGuest').hidden = false;
  $('acctUser').hidden  = true;
}

function handleSessionExpired() {
  token.clear();
  applyLoggedOut();
  buildGuestCart();
  showToast('로그인이 만료되었습니다. 다시 로그인해 주세요.');
  openModal('login');
}

// 로그인/가입 직후 비로그인 장바구니를 계정으로 병합
async function mergeGuestCart() {
  const items = guestCart.get();
  if (items.length === 0) return loadCart();

  const res = await rpc('cart_merge', { p_token: token.get(), p_items: items });
  if (res.ok) {
    guestCart.clear();
    applyCartPayload(res);
    showToast('담아두신 상품을 계정 장바구니에 저장했습니다.');
  } else {
    await loadCart();
  }
}

async function doSignup(e) {
  e.preventDefault();
  const f = e.target;
  clearMsg();

  if (f.password.value !== f.password2.value) {
    return showMsg('비밀번호가 서로 일치하지 않습니다.');
  }

  await withBusy(f, '가입 중...', async () => {
    const res = await rpc('auth_signup', {
      p_username: f.username.value.trim(),
      p_password: f.password.value,
    });
    if (!res.ok) return showMsg(res.error);

    token.set(res.token);
    applySession(res.user);
    pendingPassword = f.password.value;   // 바로 이어지는 복구정보 등록에만 사용
    f.reset();
    $('signupIdHint').textContent = '';
    await mergeGuestCart();

    switchView('recovery');
    showMsg(`${res.user.username} 님, 가입이 완료되었습니다. 지금 복구 정보를 등록해 두시면 나중에 아이디·비밀번호를 잊어버려도 직접 찾을 수 있습니다.`, 'success');
  });
}

async function doLogin(e) {
  e.preventDefault();
  const f = e.target;
  clearMsg();

  await withBusy(f, '로그인 중...', async () => {
    const res = await rpc('auth_login', {
      p_username: f.username.value.trim(),
      p_password: f.password.value,
    });
    if (!res.ok) return showMsg(res.error);

    token.set(res.token);
    applySession(res.user);
    f.reset();
    await mergeGuestCart();
    closeModal();
    showToast(res.message);
  });
}

async function doLogout() {
  const t = token.get();
  token.clear();
  applyLoggedOut();
  buildGuestCart();           // 로그아웃 후에는 비로그인 장바구니(보통 빈 상태)
  closeModal();
  showToast('로그아웃되었습니다. 장바구니는 계정에 그대로 저장되어 있습니다.');
  if (t) rpc('auth_logout', { p_token: t });
}

async function doFindId(e) {
  e.preventDefault();
  const f = e.target;
  clearMsg();

  await withBusy(f, '조회 중...', async () => {
    const res = await rpc('auth_find_id', {
      p_birthdate: f.birthdate.value,
      p_phone: f.phone.value.trim(),
    });
    if (!res.ok) return showMsg(res.error);

    const list = res.accounts
      .map(a => `<code>${esc(a.username)}</code> <small>(${new Date(a.created_at).toLocaleDateString('ko-KR')} 가입)</small>`)
      .join(' ');
    showMsg(`회원님의 아이디입니다.<br />${list}`, 'success', true);
    f.reset();
  });
}

async function doResetPassword(e) {
  e.preventDefault();
  const f = e.target;
  clearMsg();

  if (f.newPassword.value !== f.newPassword2.value) {
    return showMsg('새 비밀번호가 서로 일치하지 않습니다.');
  }

  await withBusy(f, '변경 중...', async () => {
    const res = await rpc('auth_reset_password', {
      p_username: f.username.value.trim(),
      p_birthdate: f.birthdate.value,
      p_phone: f.phone.value.trim(),
      p_new_password: f.newPassword.value,
    });
    if (!res.ok) return showMsg(res.error);

    f.reset();
    switchView('login');
    showMsg(res.message, 'success');
  });
}

async function doChangePassword(e) {
  e.preventDefault();
  const f = e.target;
  clearMsg();

  if (f.newPassword.value !== f.newPassword2.value) {
    return showMsg('새 비밀번호가 서로 일치하지 않습니다.');
  }

  await withBusy(f, '변경 중...', async () => {
    const res = await rpc('auth_change_password', {
      p_token: token.get(),
      p_current_password: f.currentPassword.value,
      p_new_password: f.newPassword.value,
    });
    if (!res.ok) return showMsg(res.error);

    token.set(res.token);   // 다른 기기 세션은 종료되고 새 토큰 발급
    f.reset();
    showMsg(res.message, 'success');
  });
}

async function doChangeUsername(e) {
  e.preventDefault();
  const f = e.target;
  clearMsg();

  await withBusy(f, '변경 중...', async () => {
    const res = await rpc('auth_change_username', {
      p_token: token.get(),
      p_password: f.password.value,
      p_new_username: f.newUsername.value.trim(),
    });
    if (!res.ok) return showMsg(res.error);

    applySession(res.user);
    f.reset();
    renderAccount();
    updateCartUI();
    showMsg(res.message, 'success');
  });
}

// 복구 정보 저장 — 가입 직후(view-recovery)와 내 정보(pane-rec) 양쪽에서 사용
async function doSaveRecovery(e) {
  e.preventDefault();
  const f = e.target;
  clearMsg();

  const pw = f.password ? f.password.value : pendingPassword;
  if (!pw) {
    switchView('account');
    return showMsg('비밀번호를 입력해 주세요.');
  }

  await withBusy(f, '저장 중...', async () => {
    const res = await rpc('auth_update_recovery', {
      p_token: token.get(),
      p_password: pw,
      p_birthdate: f.birthdate.value,
      p_phone: f.phone.value.trim(),
    });
    if (!res.ok) return showMsg(res.error);

    pendingPassword = null;
    if (f.password) f.password.value = '';
    await refreshMe();

    if (f.id === 'view-recovery') {
      closeModal();
      showToast('복구 정보가 등록되었습니다. 이제 아이디·비밀번호를 잊어버려도 찾을 수 있습니다.');
    } else {
      renderAccount();
      showMsg(res.message, 'success');
    }
  });
}

// 아이디 중복 확인 (입력 중 디바운스)
let idCheckTimer;
function checkUsername(input) {
  const hint = $('signupIdHint');
  const v = input.value.trim();
  clearTimeout(idCheckTimer);

  if (v.length < 4) { hint.textContent = ''; hint.className = 'fld-hint'; return; }

  idCheckTimer = setTimeout(async () => {
    const res = await rpc('auth_check_username', { p_username: v });
    if (res.available) {
      hint.textContent = '✓ ' + res.message;
      hint.className = 'fld-hint ok';
    } else {
      hint.textContent = '✕ ' + (res.error || '사용할 수 없는 아이디입니다.');
      hint.className = 'fld-hint bad';
    }
  }, 400);
}

// 내 정보 화면
function switchAcctTab(key, btn) {
  ['pw', 'id', 'rec'].forEach(k => { $('pane-' + k).hidden = (k !== key); });
  document.querySelectorAll('.acct-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  clearMsg();
}

function renderAccount() {
  if (!currentUser) return;
  const u = currentUser;
  const joined = u.created_at ? new Date(u.created_at).toLocaleDateString('ko-KR') : '-';

  $('acctSummary').innerHTML = `
    <dl>
      <dt>아이디</dt><dd>${esc(u.username)}</dd>
      <dt>가입일</dt><dd>${joined}</dd>
      <dt>복구 정보</dt><dd>${
        u.has_recovery
          ? `${esc(u.birthdate)} · ${esc(u.phone_masked)}`
          : '<span class="warn">미등록 — 등록해 두셔야 아이디·비밀번호를 찾을 수 있습니다</span>'
      }</dd>
    </dl>`;

  const rec = $('pane-rec');
  if (u.has_recovery) {
    rec.birthdate.value = u.birthdate || '';
    rec.phone.value     = u.phone || '';
  }
}

// 서버에서 내 정보 다시 읽기
async function refreshMe() {
  const t = token.get();
  if (!t) { applyLoggedOut(); return false; }

  const res = await rpc('auth_me', { p_token: t });
  if (!res.ok) { token.clear(); applyLoggedOut(); return false; }

  applySession(res.user);
  return true;
}

// =====================================================================
// 기타
// =====================================================================
function submitForm(e) {
  e.preventDefault();
  showToast('문의가 접수되었습니다. 빠른 시일 내에 연락드리겠습니다.');
  e.target.reset();
}

let toastTimer;
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

window.addEventListener('scroll', () => {
  document.querySelector('.header').style.background =
    window.scrollY > 80 ? 'rgba(27,94,32,1)' : 'rgba(27,94,32,.95)';
});

// ESC 로 모달/장바구니 닫기
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if ($('authModal').classList.contains('open')) closeModal();
  else if ($('cartPanel').classList.contains('open')) toggleCart();
});

// =====================================================================
// 초기 로드
// =====================================================================
(async () => {
  allProducts = await fetchProducts();
  renderProducts('전체');

  await refreshMe();   // 저장된 토큰으로 로그인 상태 복원
  await loadCart();    // 로그인 시 DB 장바구니 / 비로그인 시 임시 장바구니
})();

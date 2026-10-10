// =====================================================================
// 초록마트 — Supabase 연동 (상품 / 회원 / 계정별 장바구니)
// =====================================================================
const SUPABASE_URL = 'https://zfpybmwebncpjydfebkn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_gYpLXW6pRTo5AzuHw4jU0Q_ve8Y4Ga1';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const TOKEN_KEY = 'chorok.token';        // 로그인 세션 토큰
const GUEST_KEY = 'chorok.guestCart';    // 비로그인 임시 장바구니
const GWISH_KEY = 'chorok.guestWish';    // 비로그인 임시 찜 목록

// ===== 상태 =====
let allProducts = [];
let cart = [];              // [{ product_id, name, img, price, discount, sale_price, qty }]
let wishItems = [];         // 찜 목록 (로그인 시 Supabase 저장)
let wishIds = new Set();    // 상품카드 하트 표시용
let currentFilter = '전체';
let currentUser = null;     // 로그인한 회원 정보 (null = 비로그인)
let pendingPassword = null; // 가입 직후 복구정보 등록에만 잠시 사용
let checkoutState = null;   // 주문서 미리보기 데이터
let myAddresses = [];       // 주소록 (로그인 시 Supabase 저장)

// 배송 정책 — 서버(app.shop_config)에서 받아오고, 받기 전에는 기본값을 쓴다
let shipPolicy = { free_threshold: 30000, shipping_fee: 3000 };

// 배송비 계산 (서버 app.calc_shipping 과 동일한 규칙)
function calcShipping(subtotal) {
  if (!subtotal || subtotal <= 0) return 0;
  return subtotal >= shipPolicy.free_threshold ? 0 : shipPolicy.shipping_fee;
}

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

const guestWish = {
  get() {
    try { const v = JSON.parse(localStorage.getItem(GWISH_KEY) || '[]'); return Array.isArray(v) ? v : []; }
    catch { return []; }
  },
  set(ids)   { try { localStorage.setItem(GWISH_KEY, JSON.stringify(ids)); } catch {} },
  clear()    { try { localStorage.removeItem(GWISH_KEY); } catch {} },
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
    const stock = p.stock ?? 0;
    const out = stock <= 0;
    const wished = wishIds.has(p.id);

    const stockCls  = out ? 'out' : (stock <= 10 ? 'low' : '');
    const stockText = out ? '품절' : (stock <= 10 ? `품절 임박 · 남은 수량 ${stock}개` : `재고 ${stock}개`);

    return `
    <div class="product-card" data-id="${p.id}">
      <div class="product-img">
        <img src="${esc(p.img)}" alt="${esc(p.name)}" loading="lazy" />
        ${out ? '<div class="soldout-mask">SOLD OUT</div>' : ''}
        <button class="wish-heart${wished ? ' on' : ''}" onclick="toggleWishItem(${p.id})"
                title="${wished ? '찜 해제' : '찜하기'}" aria-label="찜하기">♥</button>
        ${p.badge ? `<span class="product-badge${isBest ? ' badge-best' : ''}">${esc(p.badge)}</span>` : ''}
        <span class="product-discount-badge">-${p.discount}%</span>
      </div>
      <div class="product-info">
        <div class="product-category">${esc(p.category)}</div>
        <div class="product-name">${esc(p.name)}</div>
        <div class="product-desc">${esc(p.desc || '')}</div>
        <div class="product-stock ${stockCls}">${stockText}</div>
        <div class="product-bottom">
          <div class="price-group">
            <span class="product-original-price">${p.price.toLocaleString()}원</span>
            <div class="price-row">
              <span class="product-price">${salePrice.toLocaleString()}원</span>
              <span class="product-discount-rate">-${p.discount}%</span>
            </div>
          </div>
          <button class="add-btn" onclick="addToCart(${p.id})" ${out ? 'disabled' : ''}>
            ${out ? '품절' : '담기'}
          </button>
        </div>
      </div>
    </div>
  `;
  }).join('');
}

function filterProducts(filter) {
  currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cat === filter);
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
  if (res.notice) showToast(res.notice);   // 재고 상한 등 서버 안내
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
  const totalQty = cart.reduce((s, i) => s + i.qty, 0);
  const subtotal = cart.reduce((s, i) => s + i.sale_price * i.qty, 0);
  const ship     = calcShipping(subtotal);
  const total    = subtotal + ship;

  $('cartCount').textContent    = totalQty;
  $('cartSubtotal').textContent = subtotal.toLocaleString() + '원';
  $('cartShipFee').textContent  = ship === 0 ? '무료' : ship.toLocaleString() + '원';
  $('cartTotal').textContent    = total.toLocaleString();

  // 무료배송 안내
  const ship$ = $('cartShip');
  const remain = Math.max(0, shipPolicy.free_threshold - subtotal);
  if (subtotal === 0) {
    ship$.textContent = '';
    ship$.className = 'cart-ship';
  } else if (remain > 0) {
    ship$.textContent = `🚚 ${remain.toLocaleString()}원 더 담으면 배송비가 무료입니다. `
                      + `(${shipPolicy.free_threshold.toLocaleString()}원 이상 무료)`;
    ship$.className = 'cart-ship';
  } else {
    ship$.textContent = '🚚 무료배송 대상입니다.';
    ship$.className = 'cart-ship free';
  }

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

// =====================================================================
// 찜하기 — 로그인 시 Supabase(app.wishlist)에 계정별로 저장
// =====================================================================
function applyWishPayload(res) {
  if (!res.ok) { showToast(res.error); return false; }
  wishItems = res.items || [];
  wishIds = new Set((res.ids || []).map(Number));
  updateWishUI();
  renderProducts(currentFilter);   // 카드 하트 상태 갱신
  return true;
}

function buildGuestWish() {
  const ids = guestWish.get();
  wishIds = new Set(ids.map(Number));
  wishItems = ids
    .map(id => allProducts.find(p => p.id === id))
    .filter(Boolean)
    .map(p => ({
      product_id: p.id, name: p.name, img: p.img, category: p.category,
      price: p.price, discount: p.discount, sale_price: getSalePrice(p), stock: p.stock,
    }))
    .reverse();
  updateWishUI();
  renderProducts(currentFilter);
}

async function loadWishlist() {
  if (currentUser) {
    applyWishPayload(await rpc('wishlist_get', { p_token: token.get() }));
  } else {
    buildGuestWish();
  }
}

async function toggleWishItem(productId) {
  const p = allProducts.find(x => x.id === productId);
  if (!p) return;

  if (currentUser) {
    const res = await rpc('wishlist_toggle', { p_token: token.get(), p_product_id: productId });
    if (res.ok === false && res.error === '로그인이 필요합니다.') return handleSessionExpired();
    if (!applyWishPayload(res)) return;
    showToast(`"${p.name}" ${res.wished ? '을(를) 찜했습니다.' : ' 찜을 해제했습니다.'}`);
  } else {
    let ids = guestWish.get().map(Number);
    const on = ids.includes(productId);
    ids = on ? ids.filter(i => i !== productId) : [...ids, productId];
    guestWish.set(ids);
    buildGuestWish();
    showToast(on ? `"${p.name}" 찜을 해제했습니다.`
                 : `"${p.name}"을(를) 찜했습니다. 로그인하시면 계정에 저장됩니다.`);
  }
}

async function removeWish(productId) {
  if (currentUser) {
    const res = await rpc('wishlist_remove', { p_token: token.get(), p_product_id: productId });
    if (res.ok === false && res.error === '로그인이 필요합니다.') return handleSessionExpired();
    applyWishPayload(res);
  } else {
    guestWish.set(guestWish.get().map(Number).filter(i => i !== productId));
    buildGuestWish();
  }
}

async function wishToCart(productId) {
  if (currentUser) {
    const res = await rpc('wishlist_to_cart', { p_token: token.get(), p_product_id: productId });
    if (res.ok === false && res.error === '로그인이 필요합니다.') return handleSessionExpired();
    if (!applyCartPayload(res)) return;
    showToast('장바구니에 담았습니다.');
  } else {
    await addToCart(productId);
  }
}

function updateWishUI() {
  $('wishCount').textContent = wishItems.length;
  $('wishNotice').hidden = !!currentUser;

  const box = $('wishItems');
  if (wishItems.length === 0) {
    box.innerHTML = '<p class="cart-empty">찜한 상품이 없습니다.<br />상품 이미지의 ♥ 를 눌러 담아보세요.</p>';
    return;
  }

  box.innerHTML = wishItems.map(item => {
    const out = (item.stock ?? 0) <= 0;
    return `
    <div class="cart-item">
      <div class="cart-item-img">
        <img src="${esc(item.img)}" alt="${esc(item.name)}" />
      </div>
      <div class="cart-item-info">
        <div class="cart-item-name">${esc(item.name)}</div>
        <div class="cart-item-price">${item.sale_price.toLocaleString()}원
          <span class="cart-discount-rate">-${item.discount}%</span>
        </div>
      </div>
      <button class="qty-btn" onclick="wishToCart(${item.product_id})"
              title="장바구니 담기" ${out ? 'disabled' : ''}>${out ? '품절' : '담기'}</button>
      <button class="remove-btn" onclick="removeWish(${item.product_id})" title="찜 해제">✕</button>
    </div>`;
  }).join('');
}

function toggleWish() {
  const panel   = $('wishPanel');
  const overlay = $('wishOverlay');
  panel.classList.toggle('open');
  overlay.classList.toggle('open');
  document.body.style.overflow = panel.classList.contains('open') ? 'hidden' : '';
}

// 로그인 시 비로그인 찜 목록을 계정으로 옮김
// (토글이 아니라 wishlist_merge 로 "추가만" 한다 — 이미 찜한 상품이 해제되지 않도록)
async function mergeGuestWish() {
  const ids = guestWish.get().map(Number).filter(Number.isFinite);
  if (ids.length === 0) return loadWishlist();

  const res = await rpc('wishlist_merge', { p_token: token.get(), p_ids: ids });
  if (res.ok) {
    guestWish.clear();
    applyWishPayload(res);
  } else {
    await loadWishlist();
  }
}

// =====================================================================
// 주문서
// =====================================================================
async function openCheckout() {
  if (!currentUser) {
    showToast('주문하시려면 로그인이 필요합니다.');
    if ($('cartPanel').classList.contains('open')) toggleCart();
    return openModal('login');
  }
  if (cart.length === 0) { showToast('장바구니가 비어 있습니다.'); return; }

  const res = await rpc('order_preview', { p_token: token.get() });
  if (res.ok === false && res.error === '로그인이 필요합니다.') return handleSessionExpired();
  if (!res.ok) { showToast(res.error); return; }

  checkoutState = res;
  myAddresses = res.addresses || [];
  renderCheckout(res);
  renderAddrPicker();

  // 기본 배송지 → 없으면 지난 주문 배송지로 자동 채움
  const def = myAddresses.find(a => a.is_default) || myAddresses[0];
  if (def) {
    applyAddrToForm(def);
    $('zipHint').textContent = '주소록의 기본 배송지를 불러왔습니다. 바꾸려면 위에서 선택하거나 우편번호를 다시 찾으세요.';
  } else {
    const last = await rpc('order_last_address', { p_token: token.get() });
    if (last.ok && last.address) {
      applyAddrToForm({
        receiver_name:  last.address.receiver_name,
        receiver_phone: last.address.receiver_phone,
        postcode:       last.address.postcode,
        address1:       last.address.address1,
        address2:       last.address.address2,
      });
      $('zipHint').textContent = '지난 주문의 배송지를 불러왔습니다. 바꾸려면 우편번호 찾기를 누르세요.';
    }
  }

  if ($('cartPanel').classList.contains('open')) toggleCart();
  $('checkoutForm').hidden = false;
  $('checkoutDone').hidden = true;
  $('checkoutFoot').hidden = false;
  $('checkoutOverlay').classList.add('open');
  $('checkoutPanel').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCheckout() {
  $('checkoutOverlay').classList.remove('open');
  $('checkoutPanel').classList.remove('open');
  document.body.style.overflow = '';
}

// 주문서 상단 — 저장된 배송지 선택 버튼
function renderAddrPicker() {
  const sec = $('coAddrSec');
  const box = $('coAddrPicker');
  if (myAddresses.length === 0) { sec.hidden = true; box.innerHTML = ''; return; }

  sec.hidden = false;
  box.innerHTML = myAddresses.map(a => `
    <button type="button" class="co-addr-item" data-id="${a.id}" onclick="pickAddress(${a.id})">
      <span class="pick">○</span>
      <span>
        <strong>${esc(a.label || '배송지')}</strong>${a.is_default ? '<span class="tag">기본</span>' : ''}<br />
        ${esc(a.receiver_name)} · ${esc(fmtPhone(a.receiver_phone))}<br />
        (${esc(a.postcode)}) ${esc(a.address1)} ${esc(a.address2)}
      </span>
    </button>`).join('');
}

function pickAddress(id) {
  const a = myAddresses.find(x => x.id === id);
  if (!a) return;
  applyAddrToForm(a);
  $('zipHint').textContent = `“${a.label || '배송지'}” 주소를 적용했습니다.`;
  $('zipHint').className = 'fld-hint ok';
}

function applyAddrToForm(a) {
  const f = $('shipForm');
  f.receiverName.value  = a.receiver_name || '';
  f.receiverPhone.value = fmtPhone(a.receiver_phone || '');
  f.postcode.value      = a.postcode || '';
  f.address1.value      = a.address1 || '';
  f.address2.value      = a.address2 || '';

  // 선택 표시
  document.querySelectorAll('.co-addr-item').forEach(el => {
    const on = a.id != null && Number(el.dataset.id) === Number(a.id);
    el.classList.toggle('on', on);
    el.querySelector('.pick').textContent = on ? '◉' : '○';
  });
  // 주소록에 이미 있는 주소면 "저장" 체크 해제
  if (a.id != null) {
    $('saveAddrChk').checked = false;
    $('saveAddrLabelWrap').hidden = true;
  }
}

function renderCheckout(res) {
  const items = res.items || [];
  const subtotal = res.subtotal || 0;
  const shipping = res.shipping_fee || 0;
  const total = subtotal + shipping;

  $('coCount').textContent = `${items.reduce((s, i) => s + i.qty, 0)}개`;
  $('coItems').innerHTML = items.map(i => `
    <div class="co-item">
      <img src="${esc(i.img)}" alt="${esc(i.name)}" />
      <div>
        <div class="co-item-name">${esc(i.name)}</div>
        <div class="co-item-sub">${i.sale_price.toLocaleString()}원 × ${i.qty}개
          · <span style="color:#d93025">-${i.discount}%</span></div>
      </div>
      <div class="co-item-price">${(i.sale_price * i.qty).toLocaleString()}원</div>
    </div>`).join('');

  $('coSubtotal').textContent = subtotal.toLocaleString() + '원';
  $('coShipping').textContent = shipping === 0 ? '무료' : shipping.toLocaleString() + '원';
  $('coTotal').textContent    = total.toLocaleString() + '원';
  $('coSubmitLabel').textContent = total.toLocaleString() + '원 결제하기';

  // 무료배송까지 남은 금액 안내
  const note = $('coShipNote');
  const remain = res.free_remain ?? Math.max(0, shipPolicy.free_threshold - subtotal);
  if (shipping === 0) {
    note.textContent = `🚚 ${(res.free_threshold ?? shipPolicy.free_threshold).toLocaleString()}원 이상 구매로 배송비가 무료입니다.`;
    note.className = 'co-ship-note free';
  } else {
    note.textContent = `🚚 ${remain.toLocaleString()}원 더 담으시면 배송비 `
                     + `${shipping.toLocaleString()}원이 무료가 됩니다.`;
    note.className = 'co-ship-note';
  }

  const short = res.shortage || [];
  const sEl = $('coShortage');
  if (short.length) {
    sEl.hidden = false;
    sEl.innerHTML = '재고가 부족한 상품이 있습니다.<br />' + short
      .map(s => `· ${esc(s.name)} — 주문 ${s.want}개 / 재고 ${s.stock}개`).join('<br />');
    $('coSubmitBtn').disabled = true;
  } else {
    sEl.hidden = true;
    $('coSubmitBtn').disabled = false;
  }
  showCoMsg('', null);
}

function showCoMsg(text, kind) {
  const el = $('checkoutMsg');
  if (!text) { el.hidden = true; el.textContent = ''; return; }
  el.textContent = text;
  el.className = 'co-msg ' + kind;
  el.hidden = false;
}

// 우편번호 검색 (다음 우편번호 서비스)
//  target: 'checkout'(주문서) | 'addr'(주소록 폼)
function findPostcode(target = 'checkout') {
  const ids = target === 'addr'
    ? { zip: 'addrPostcode', a1: 'addrAddress1', a2: 'addrAddress2', hint: null }
    : { zip: 'postcode',     a1: 'address1',     a2: 'address2',     hint: 'zipHint' };

  const hint = (text, cls) => {
    if (!ids.hint) return;
    $(ids.hint).textContent = text;
    $(ids.hint).className = 'fld-hint ' + cls;
  };

  if (typeof daum === 'undefined' || !daum.Postcode) {
    // 스크립트가 차단된 경우: 직접 입력 모드로 전환
    $(ids.zip).readOnly = false;
    $(ids.a1).readOnly  = false;
    $(ids.zip).focus();
    hint('우편번호 검색을 불러오지 못했습니다. 우편번호와 주소를 직접 입력해 주세요.', 'bad');
    if (target === 'addr') showMyMsg('우편번호 검색을 불러오지 못해 직접 입력 모드로 전환했습니다.', 'error');
    return;
  }

  new daum.Postcode({
    oncomplete(data) {
      const addr = data.userSelectedType === 'R' ? data.roadAddress : data.jibunAddress;
      let extra = '';
      if (data.userSelectedType === 'R') {
        if (data.bname && /[동로가]$/.test(data.bname)) extra += data.bname;
        if (data.buildingName && data.apartment === 'Y') {
          extra += (extra ? ', ' : '') + data.buildingName;
        }
      }
      $(ids.zip).value = data.zonecode;
      $(ids.a1).value  = addr + (extra ? ` (${extra})` : '');
      hint('상세주소를 입력해 주세요.', 'ok');
      $(ids.a2).focus();
    },
  }).open();
}

async function submitOrder(e) {
  e.preventDefault();
  const f = e.target;
  showCoMsg('', null);

  const btn = $('coSubmitBtn');
  const label = $('coSubmitLabel').textContent;
  btn.disabled = true;
  $('coSubmitLabel').textContent = '주문 처리 중...';

  try {
    const res = await rpc('order_create', {
      p_token: token.get(),
      p_receiver_name:  f.receiverName.value.trim(),
      p_receiver_phone: f.receiverPhone.value.trim(),
      p_postcode:       f.postcode.value.trim(),
      p_address1:       f.address1.value.trim(),
      p_address2:       f.address2.value.trim(),
      p_memo:           f.memo.value.trim(),
      p_save_address:   f.saveAddress.checked,
      p_address_label:  f.addressLabel.value.trim(),
    });

    if (res.ok === false && res.error === '로그인이 필요합니다.') {
      closeCheckout();
      return handleSessionExpired();
    }
    if (!res.ok) { showCoMsg(res.error, 'error'); return; }

    renderOrderDone(res.order);
    allProducts = await fetchProducts();      // 재고 반영
    renderProducts(currentFilter);
    await loadCart();                          // 서버에서 비워짐
    await refreshMe();
  } finally {
    btn.disabled = false;
    $('coSubmitLabel').textContent = label;
  }
}

function renderOrderDone(o) {
  $('checkoutForm').hidden = true;
  $('checkoutFoot').hidden = true;
  const box = $('checkoutDone');
  box.hidden = false;

  box.innerHTML = `
    <div class="done-wrap">
      <div class="done-icon">🌿</div>
      <h4>주문이 접수되었습니다</h4>
      <p>초록마트를 이용해 주셔서 감사합니다.</p>
      <div class="done-no">${esc(o.order_no)}</div>
    </div>

    <div class="done-card">
      <h5>배송지</h5>
      <div class="done-addr">
        <strong>${esc(o.receiver_name)}</strong> · ${esc(fmtPhone(o.receiver_phone))}<br />
        (${esc(o.postcode)}) ${esc(o.address1)}<br />
        ${esc(o.address2 || '')}
        ${o.memo ? `<br /><span style="color:#757575">요청: ${esc(o.memo)}</span>` : ''}
      </div>
    </div>

    <div class="done-card">
      <h5>주문 상품 ${o.items.reduce((s, i) => s + i.qty, 0)}개</h5>
      <div class="co-items">
        ${o.items.map(i => `
          <div class="co-item">
            <img src="${esc(i.img)}" alt="${esc(i.name)}" />
            <div>
              <div class="co-item-name">${esc(i.name)}</div>
              <div class="co-item-sub">${i.sale_price.toLocaleString()}원 × ${i.qty}개</div>
            </div>
            <div class="co-item-price">${i.line_total.toLocaleString()}원</div>
          </div>`).join('')}
      </div>
      <dl class="co-sum" style="margin-top:14px">
        <dt>상품 금액</dt><dd>${o.subtotal.toLocaleString()}원</dd>
        <dt>배송비</dt><dd>${o.shipping_fee === 0 ? '무료' : o.shipping_fee.toLocaleString() + '원'}</dd>
        <dt class="co-total-label">총 결제 금액</dt>
        <dd class="co-total-value">${o.total.toLocaleString()}원</dd>
      </dl>
    </div>

    <div class="done-wrap">
      <button class="co-submit" onclick="closeCheckout()">쇼핑 계속하기</button>
    </div>`;
}

function fmtPhone(p) {
  const d = String(p || '').replace(/[^0-9]/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return p;
}

// =====================================================================
// 주문 내역 (내 정보 탭)
// =====================================================================
async function loadOrders() {
  const box = $('orderList');
  if (!currentUser) { box.innerHTML = '<p class="cart-empty">로그인이 필요합니다.</p>'; return; }

  const res = await rpc('order_list', { p_token: token.get() });
  if (!res.ok) { box.innerHTML = `<p class="cart-empty">${esc(res.error)}</p>`; return; }

  const list = res.orders || [];
  if (list.length === 0) {
    box.innerHTML = '<p class="cart-empty">아직 주문 내역이 없습니다.</p>';
    return;
  }

  box.innerHTML = list.map(o => `
    <div class="order-card" onclick="showOrderDetail('${esc(o.order_no)}')">
      <div class="order-card-top">
        <span class="order-no">${esc(o.order_no)}</span>
        <span class="order-status">${esc(o.status)}</span>
      </div>
      <div class="order-card-body">
        <img src="${esc(o.first_img)}" alt="" />
        <div class="order-sum">
          <strong>${esc(o.first_name)}</strong>${o.item_count > 1 ? ` 외 ${o.item_count - 1}개` : ''}<br />
          <strong>${o.total.toLocaleString()}원</strong>
          <span class="order-date">· ${new Date(o.created_at).toLocaleDateString('ko-KR')}</span>
        </div>
      </div>
    </div>`).join('');
}

async function showOrderDetail(orderNo) {
  const res = await rpc('order_detail', { p_token: token.get(), p_order_no: orderNo });
  if (!res.ok) { showToast(res.error); return; }

  closeMyPage();
  renderOrderDone(res.order);
  $('checkoutForm').hidden = true;
  $('checkoutOverlay').classList.add('open');
  $('checkoutPanel').classList.add('open');
  document.body.style.overflow = 'hidden';
}

// =====================================================================
// 이미지 출처 표기 (CC BY 계열 저작자 표시)
// =====================================================================
function toggleCredits() {
  const body = $('creditsBody');
  body.hidden = !body.hidden;
  $('creditsArrow').textContent = body.hidden ? '▾' : '▴';
  if (!body.hidden) renderCredits();
}

function renderCredits() {
  const ul = $('creditsList');
  if (ul.dataset.done) return;

  const rows = allProducts.filter(p => p.img_source);
  ul.innerHTML = rows.length === 0
    ? '<li>표시할 출처 정보가 없습니다.</li>'
    : rows.map(p => `
<li>${esc(p.name)} — <a href="${esc(p.img_source)}" target="_blank" rel="noopener noreferrer">${esc(p.img_license || '')}</a>${p.img_author && p.img_author !== '-' ? ` / ${esc(p.img_author)}` : ''}</li>`).join('');
  ul.dataset.done = '1';
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
};

function openModal(view) {
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
  buildGuestWish();
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
    await mergeGuestWish();

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
    await mergeGuestWish();
    await refreshMe();        // 주소록·배송정책까지 최신화
    closeModal();
    showToast(res.message);
  });
}

async function doLogout() {
  const t = token.get();
  token.clear();
  applyLoggedOut();
  buildGuestCart();           // 로그아웃 후에는 비로그인 장바구니(보통 빈 상태)
  buildGuestWish();
  closeModal();
  showToast('로그아웃되었습니다. 장바구니·찜 목록은 계정에 그대로 저장되어 있습니다.');
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
  showMyMsg('', null);

  if (f.newPassword.value !== f.newPassword2.value) {
    return showMyMsg('새 비밀번호가 서로 일치하지 않습니다.', 'error');
  }

  await withBusy(f, '변경 중...', async () => {
    const res = await rpc('auth_change_password', {
      p_token: token.get(),
      p_current_password: f.currentPassword.value,
      p_new_password: f.newPassword.value,
    });
    if (!res.ok) return showMyMsg(res.error, 'error');

    token.set(res.token);   // 다른 기기 세션은 종료되고 새 토큰 발급
    f.reset();
    showMyMsg(res.message, 'success');
  });
}

async function doChangeUsername(e) {
  e.preventDefault();
  const f = e.target;
  showMyMsg('', null);

  await withBusy(f, '변경 중...', async () => {
    const res = await rpc('auth_change_username', {
      p_token: token.get(),
      p_password: f.password.value,
      p_new_username: f.newUsername.value.trim(),
    });
    if (!res.ok) return showMyMsg(res.error, 'error');

    applySession(res.user);
    f.reset();
    renderMyProfile();
    updateCartUI();
    showMyMsg(res.message, 'success');
  });
}

// 복구 정보 저장 — 가입 직후(view-recovery)와 마이페이지(pane-rec) 양쪽에서 사용
async function doSaveRecovery(e) {
  e.preventDefault();
  const f = e.target;
  const inMyPage = f.id === 'pane-rec';
  const say = (t, k) => inMyPage ? showMyMsg(t, k === 'success' ? 'success' : 'error')
                                 : showMsg(t, k || 'error');
  if (inMyPage) showMyMsg('', null); else clearMsg();

  const pw = f.password ? f.password.value : pendingPassword;
  if (!pw) return say('비밀번호를 입력해 주세요.');

  await withBusy(f, '저장 중...', async () => {
    const res = await rpc('auth_update_recovery', {
      p_token: token.get(),
      p_password: pw,
      p_birthdate: f.birthdate.value,
      p_phone: f.phone.value.trim(),
    });
    if (!res.ok) return say(res.error);

    pendingPassword = null;
    if (f.password) f.password.value = '';
    await refreshMe();

    if (inMyPage) {
      renderMyProfile();
      say(res.message, 'success');
    } else {
      closeModal();
      showToast('복구 정보가 등록되었습니다. 이제 아이디·비밀번호를 잊어버려도 찾을 수 있습니다.');
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

// =====================================================================
// 마이페이지
// =====================================================================
async function openMyPage() {
  if (!currentUser) return openModal('login');
  if (!(await refreshMe())) return openModal('login');

  renderMyProfile();
  switchMyTab('orders', document.querySelector('.my-tab[data-tab="orders"]'));

  $('myOverlay').classList.add('open');
  $('myPage').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeMyPage() {
  $('myOverlay').classList.remove('open');
  $('myPage').classList.remove('open');
  document.body.style.overflow = '';
  closeAddrForm();
}

function switchMyTab(key, btn) {
  ['orders', 'address', 'wish', 'info'].forEach(k => { $('mp-' + k).hidden = (k !== key); });
  document.querySelectorAll('.my-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  showMyMsg('', null);

  if (key === 'orders')  loadOrders();
  if (key === 'address') loadAddresses();
  if (key === 'wish')    renderMyWish();
  if (key === 'info')    fillRecoveryForm();
}

function switchInfoTab(key, btn) {
  ['pw', 'id', 'rec'].forEach(k => { $('pane-' + k).hidden = (k !== key); });
  document.querySelectorAll('.info-tabs .acct-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  showMyMsg('', null);
}

function showMyMsg(text, kind) {
  const el = $('myMsg');
  if (!text) { el.hidden = true; el.textContent = ''; return; }
  el.textContent = text;
  el.className = 'my-msg ' + kind;
  el.hidden = false;
  $('myPage').querySelector('.my-body').scrollTop = 0;
}

function renderMyProfile() {
  const u = currentUser;
  if (!u) return;
  const joined = u.created_at ? new Date(u.created_at).toLocaleDateString('ko-KR') : '-';

  $('myProfile').innerHTML = `
    <div class="mp-id">👤 ${esc(u.username)} <span style="font-size:.75rem;font-weight:600">님</span></div>
    <div class="mp-meta">
      가입일 ${joined}<br />
      복구 정보 ${u.has_recovery
        ? `${esc(u.birthdate)} · ${esc(u.phone_masked)}`
        : '<span class="mp-warn">미등록 — 아이디·비밀번호를 잊으면 찾을 수 없습니다</span>'}
    </div>
    <div class="mp-stats">
      <div class="mp-stat"><b>${cart.reduce((s, i) => s + i.qty, 0)}</b><span>장바구니</span></div>
      <div class="mp-stat"><b>${wishItems.length}</b><span>찜</span></div>
      <div class="mp-stat"><b>${myAddresses.length}</b><span>주소록</span></div>
    </div>`;
}

function fillRecoveryForm() {
  const u = currentUser;
  const rec = $('pane-rec');
  if (u && u.has_recovery) {
    rec.birthdate.value = u.birthdate || '';
    rec.phone.value     = u.phone || '';
  }
}

// 마이페이지 찜 목록
function renderMyWish() {
  const box = $('myWishGrid');
  if (wishItems.length === 0) {
    box.innerHTML = '<p class="cart-empty">찜한 상품이 없습니다.</p>';
    return;
  }
  box.innerHTML = wishItems.map(i => {
    const out = (i.stock ?? 0) <= 0;
    return `
    <div class="mw-card">
      <img src="${esc(i.img)}" alt="${esc(i.name)}" />
      <div class="mw-body">
        <div class="mw-name">${esc(i.name)}</div>
        <div class="mw-price">${i.sale_price.toLocaleString()}원</div>
        <div class="mw-btns">
          <button class="mw-add" onclick="wishToCart(${i.product_id})" ${out ? 'disabled' : ''}>
            ${out ? '품절' : '담기'}</button>
          <button class="mw-del" onclick="removeWishFromMyPage(${i.product_id})">삭제</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function removeWishFromMyPage(productId) {
  await removeWish(productId);
  renderMyWish();
  renderMyProfile();
}

// =====================================================================
// 주소록
// =====================================================================

function applyAddrPayload(res) {
  if (!res.ok) { showMyMsg(res.error, 'error'); return false; }
  myAddresses = res.addresses || [];
  renderAddresses();
  renderMyProfile();
  if (res.message) showMyMsg(res.message, 'success');
  return true;
}

async function loadAddresses() {
  if (!currentUser) return;
  const res = await rpc('address_list', { p_token: token.get() });
  if (res.ok === false && res.error === '로그인이 필요합니다.') return handleSessionExpired();
  if (!res.ok) { $('addrList').innerHTML = `<p class="cart-empty">${esc(res.error)}</p>`; return; }
  myAddresses = res.addresses || [];
  renderAddresses();
  renderMyProfile();
}

function renderAddresses() {
  const box = $('addrList');
  if (myAddresses.length === 0) {
    box.innerHTML = '<p class="cart-empty">저장된 주소가 없습니다.<br />위의 “새 주소 추가”로 등록해 보세요.</p>';
    return;
  }
  box.innerHTML = myAddresses.map(a => `
    <div class="addr-card${a.is_default ? ' is-default' : ''}">
      <div class="addr-card-top">
        <span class="addr-label">${esc(a.label || '배송지')}</span>
        ${a.is_default ? '<span class="addr-default-tag">기본</span>' : ''}
      </div>
      <div class="addr-text">
        <strong>${esc(a.receiver_name)}</strong> · ${esc(fmtPhone(a.receiver_phone))}<br />
        (${esc(a.postcode)}) ${esc(a.address1)}<br />${esc(a.address2)}
      </div>
      <div class="addr-actions">
        ${a.is_default ? '' : `<button onclick="setDefaultAddress(${a.id})">기본으로</button>`}
        <button onclick="editAddress(${a.id})">수정</button>
        <button class="danger" onclick="deleteAddress(${a.id})">삭제</button>
      </div>
    </div>`).join('');
}

function openAddrForm(addr) {
  const f = $('addrForm');
  f.hidden = false;
  f.reset();
  f.id.value            = addr ? addr.id : '';
  f.label.value         = addr ? (addr.label || '') : '';
  f.receiverName.value  = addr ? addr.receiver_name : '';
  f.receiverPhone.value = addr ? fmtPhone(addr.receiver_phone) : '';
  f.postcode.value      = addr ? addr.postcode : '';
  f.address1.value      = addr ? addr.address1 : '';
  f.address2.value      = addr ? addr.address2 : '';
  f.isDefault.checked   = addr ? !!addr.is_default : false;
  $('addrSaveBtn').textContent = addr ? '수정 저장' : '저장';
  showMyMsg('', null);
  f.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeAddrForm() {
  const f = $('addrForm');
  if (f) { f.hidden = true; f.reset(); }
}

function editAddress(id) {
  const a = myAddresses.find(x => x.id === id);
  if (a) openAddrForm(a);
}

async function saveAddress(e) {
  e.preventDefault();
  const f = e.target;
  const btn = $('addrSaveBtn');
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = '저장 중...';

  try {
    const args = {
      p_token: token.get(),
      p_label: f.label.value.trim(),
      p_receiver_name: f.receiverName.value.trim(),
      p_receiver_phone: f.receiverPhone.value.trim(),
      p_postcode: f.postcode.value.trim(),
      p_address1: f.address1.value.trim(),
      p_address2: f.address2.value.trim(),
      p_is_default: f.isDefault.checked,
    };
    const res = f.id.value
      ? await rpc('address_update', { ...args, p_id: Number(f.id.value) })
      : await rpc('address_add', args);

    if (res.ok === false && res.error === '로그인이 필요합니다.') return handleSessionExpired();
    if (!res.ok) { showMyMsg(res.error, 'error'); return; }

    closeAddrForm();
    applyAddrPayload(res);
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}

async function deleteAddress(id) {
  const a = myAddresses.find(x => x.id === id);
  if (!confirm(`“${a?.label || '배송지'}” 주소를 삭제할까요?`)) return;
  const res = await rpc('address_delete', { p_token: token.get(), p_id: id });
  if (res.ok === false && res.error === '로그인이 필요합니다.') return handleSessionExpired();
  applyAddrPayload(res);
}

async function setDefaultAddress(id) {
  const res = await rpc('address_set_default', { p_token: token.get(), p_id: id });
  if (res.ok === false && res.error === '로그인이 필요합니다.') return handleSessionExpired();
  applyAddrPayload(res);
}

// 서버에서 내 정보 다시 읽기
async function refreshMe() {
  const t = token.get();
  if (!t) { applyLoggedOut(); return false; }

  // 회원 + 장바구니 + 찜 + 주소록 + 배송정책을 한 번에 최신화
  const res = await rpc('session_bootstrap', { p_token: t });
  if (!res.ok) { token.clear(); applyLoggedOut(); return false; }

  applySession(res.user);
  if (res.shipping) shipPolicy = res.shipping;
  myAddresses = res.addresses || [];
  applyCartPayload(res.cart);
  applyWishPayload(res.wishlist);
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
  if      ($('checkoutPanel').classList.contains('open')) closeCheckout();
  else if ($('myPage').classList.contains('open'))        closeMyPage();
  else if ($('authModal').classList.contains('open'))     closeModal();
  else if ($('cartPanel').classList.contains('open'))     toggleCart();
  else if ($('wishPanel').classList.contains('open'))     toggleWish();
});

// 주소록 저장 체크 시 주소 이름 입력칸 표시
document.addEventListener('change', e => {
  if (e.target && e.target.id === 'saveAddrChk') {
    $('saveAddrLabelWrap').hidden = !e.target.checked;
  }
});

// =====================================================================
// 초기 로드
// =====================================================================
// 저장된 토큰으로 회원·장바구니·찜·주소록·배송정책을 한 번에 복원한다.
// (여러 번 호출하던 것을 session_bootstrap 하나로 묶어 복원 누락 가능성을 없앰)
async function restoreSession() {
  const t = token.get();
  if (!t) {
    applyLoggedOut();
    buildGuestCart();
    buildGuestWish();
    return false;
  }

  const res = await rpc('session_bootstrap', { p_token: t });
  if (!res.ok) {                       // 만료·위조 토큰
    token.clear();
    applyLoggedOut();
    buildGuestCart();
    buildGuestWish();
    return false;
  }

  applySession(res.user);
  if (res.shipping) shipPolicy = res.shipping;
  myAddresses = res.addresses || [];
  applyCartPayload(res.cart);
  applyWishPayload(res.wishlist);

  // 로그아웃 중에 담아둔 비로그인 장바구니·찜이 있으면 계정으로 합친다
  if (guestCart.get().length) await mergeGuestCart();
  if (guestWish.get().length) await mergeGuestWish();
  return true;
}

// =====================================================================
// 초기 로드
// =====================================================================
(async () => {
  allProducts = await fetchProducts();
  renderProducts('전체');

  // 배송 정책 (비로그인 상태에서도 장바구니 배송비를 정확히 보여주기 위해)
  const pol = await rpc('shop_shipping_policy', {});
  if (pol.ok) shipPolicy = { free_threshold: pol.free_threshold, shipping_fee: pol.shipping_fee };

  await restoreSession();   // 로그인 상태 + 장바구니 + 찜 + 주소록 복원
  updateCartUI();
})();

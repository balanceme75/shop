// ===== Supabase 초기화 =====
const SUPABASE_URL  = 'https://zfpybmwebncpjydfebkn.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_gYpLXW6pRTo5AzuHw4jU0Q_ve8Y4Ga1';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ===== 상태 =====
let allProducts = [];   // DB에서 불러온 전체 상품
let cart        = [];
let currentFilter = '전체';

// ===== DB에서 상품 불러오기 =====
async function fetchProducts() {
  const { data, error } = await db
    .from('products')
    .select('*')
    .order('id');

  if (error) {
    console.error('상품 로딩 오류:', error.message);
    showToast('상품을 불러오는 중 오류가 발생했습니다.');
    return [];
  }
  // DB 컬럼 description → desc 로 매핑
  return data.map(p => ({ ...p, desc: p.description }));
}

// ===== 할인 후 판매가 =====
function getSalePrice(p) {
  return Math.round(p.price * (1 - p.discount / 100));
}

// ===== 상품 렌더링 =====
function renderProducts(filter) {
  const grid = document.getElementById('productsGrid');
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
        <img src="${p.img}" alt="${p.name}" loading="lazy" />
        ${p.badge ? `<span class="product-badge${isBest ? ' badge-best' : ''}">${p.badge}</span>` : ''}
        <span class="product-discount-badge">-${p.discount}%</span>
      </div>
      <div class="product-info">
        <div class="product-category">${p.category}</div>
        <div class="product-name">${p.name}</div>
        <div class="product-desc">${p.desc || ''}</div>
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

// ===== 필터 =====
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

  if (filter !== '전체') {
    document.getElementById('products').scrollIntoView({ behavior: 'smooth' });
  }
}

// ===== 장바구니 추가 =====
function addToCart(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;

  const salePrice = getSalePrice(product);
  const existing  = cart.find(item => item.id === productId);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ ...product, salePrice, qty: 1 });
  }

  updateCartUI();
  showToast(`"${product.name}"을(를) 장바구니에 담았습니다.`);
}

// ===== 수량 변경 =====
function changeQty(productId, delta) {
  const item = cart.find(i => i.id === productId);
  if (!item) return;

  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter(i => i.id !== productId);
  updateCartUI();
}

// ===== 상품 제거 =====
function removeFromCart(productId) {
  cart = cart.filter(i => i.id !== productId);
  updateCartUI();
}

// ===== 장바구니 UI =====
function updateCartUI() {
  const totalQty   = cart.reduce((s, i) => s + i.qty, 0);
  const totalPrice = cart.reduce((s, i) => s + i.salePrice * i.qty, 0);

  document.getElementById('cartCount').textContent = totalQty;
  document.getElementById('cartTotal').textContent = totalPrice.toLocaleString();

  const cartItems = document.getElementById('cartItems');

  if (cart.length === 0) {
    cartItems.innerHTML = '<p class="cart-empty">장바구니가 비어 있습니다.</p>';
    return;
  }

  cartItems.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="cart-item-img">
        <img src="${item.img}" alt="${item.name}" />
      </div>
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-price">${(item.salePrice * item.qty).toLocaleString()}원
          <span class="cart-discount-rate">-${item.discount}%</span>
        </div>
      </div>
      <div class="cart-item-qty">
        <button class="qty-btn" onclick="changeQty(${item.id}, -1)">−</button>
        <span class="qty-num">${item.qty}</span>
        <button class="qty-btn" onclick="changeQty(${item.id}, 1)">+</button>
      </div>
      <button class="remove-btn" onclick="removeFromCart(${item.id})" title="제거">✕</button>
    </div>
  `).join('');
}

// ===== 장바구니 열기/닫기 =====
function toggleCart() {
  const panel   = document.getElementById('cartPanel');
  const overlay = document.getElementById('cartOverlay');
  panel.classList.toggle('open');
  overlay.classList.toggle('open');
  document.body.style.overflow = panel.classList.contains('open') ? 'hidden' : '';
}

// ===== 주문하기 =====
function placeOrder() {
  if (cart.length === 0) { showToast('장바구니가 비어 있습니다.'); return; }
  const total = cart.reduce((s, i) => s + i.salePrice * i.qty, 0);
  alert(`주문이 완료되었습니다!\n총 결제 금액: ${total.toLocaleString()}원\n\n초록마트를 이용해 주셔서 감사합니다. 🌿`);
  cart = [];
  updateCartUI();
  toggleCart();
}

// ===== 문의 폼 =====
function submitForm(e) {
  e.preventDefault();
  showToast('문의가 접수되었습니다. 빠른 시일 내에 연락드리겠습니다.');
  e.target.reset();
}

// ===== 토스트 =====
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ===== 헤더 스크롤 =====
window.addEventListener('scroll', () => {
  document.querySelector('.header').style.background =
    window.scrollY > 80 ? 'rgba(27,94,32,1)' : 'rgba(27,94,32,.95)';
});

// ===== 초기 로드 (Supabase에서 상품 가져온 뒤 렌더) =====
(async () => {
  allProducts = await fetchProducts();
  renderProducts('전체');
})();

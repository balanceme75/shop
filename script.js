// ===== 상품 데이터 =====
// price: 정가 / discount: 할인율(%) / salePrice는 렌더링 시 계산
const products = [
  {
    id: 1,
    name: '프리미엄 배양토',
    category: '흙',
    price: 10000,
    discount: 20,
    desc: '식물 성장에 최적화된 영양 가득한 배양토. 배수성과 통기성이 뛰어납니다.',
    img: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=500&q=80',
    badge: '베스트',
  },
  {
    id: 2,
    name: '다육이 전용 흙',
    category: '흙',
    price: 10000,
    discount: 10,
    desc: '다육식물과 선인장에 적합한 모래 혼합 배양토. 과습을 방지합니다.',
    img: 'https://images.unsplash.com/photo-1508193638397-1c4234db14d8?w=500&q=80',
    badge: null,
  },
  {
    id: 3,
    name: '미니 테라코타 화분',
    category: '화분',
    price: 6000,
    discount: 15,
    desc: '자연스러운 테라코타 소재의 소형 화분. 통기성이 좋아 뿌리 건강에 탁월합니다.',
    img: 'https://images.unsplash.com/photo-1485955900006-10f4d324d411?w=500&q=80',
    badge: '인기',
  },
  {
    id: 4,
    name: '미니 세라믹 화분',
    category: '화분',
    price: 6000,
    discount: 5,
    desc: '심플하고 세련된 흰색 세라믹 미니 화분. 어떤 인테리어에도 잘 어울립니다.',
    img: 'https://images.unsplash.com/photo-1501004318641-b39e6451bec6?w=500&q=80',
    badge: null,
  },
  {
    id: 5,
    name: '미니 분재 화분',
    category: '화분',
    price: 6000,
    discount: 30,
    desc: '분재 전용으로 설계된 납작한 형태의 미니 도자기 화분.',
    img: 'https://images.unsplash.com/photo-1509423350716-97f9360b4e09?w=500&q=80',
    badge: '신상',
  },
  {
    id: 6,
    name: '바질 씨앗',
    category: '씨앗',
    price: 3000,
    discount: 10,
    desc: '향긋한 바질을 집에서 직접 키워보세요. 발아율 95% 이상의 프리미엄 씨앗.',
    img: 'https://images.unsplash.com/photo-1591857177580-dc82b9ac4e1e?w=500&q=80',
    badge: '추천',
  },
  {
    id: 7,
    name: '방울토마토 씨앗',
    category: '씨앗',
    price: 3000,
    discount: 15,
    desc: '베란다에서도 쉽게 키울 수 있는 방울토마토 씨앗. 달콤한 수확을 경험하세요.',
    img: 'https://images.unsplash.com/photo-1592841200221-a6898f307baa?w=500&q=80',
    badge: null,
  },
  {
    id: 8,
    name: '라벤더 씨앗',
    category: '씨앗',
    price: 3000,
    discount: 20,
    desc: '보라빛 향기를 가득 담은 라벤더 씨앗. 공기 정화와 방향 효과까지.',
    img: 'https://images.pexels.com/photos/207518/pexels-photo-207518.jpeg?auto=compress&cs=tinysrgb&w=500',
    badge: '인기',
  },
];

// 할인 후 판매가 계산
function getSalePrice(p) {
  return Math.round(p.price * (1 - p.discount / 100));
}

// ===== 장바구니 상태 =====
let cart = [];
let currentFilter = '전체';

// ===== 상품 렌더링 =====
function renderProducts(filter) {
  const grid = document.getElementById('productsGrid');
  const filtered = filter === '전체'
    ? products
    : products.filter(p => p.category === filter);

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
        <div class="product-desc">${p.desc}</div>
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
  `}).join('');
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

// ===== 장바구니 추가 (할인가 기준) =====
function addToCart(productId) {
  const product = products.find(p => p.id === productId);
  if (!product) return;

  const salePrice = getSalePrice(product);
  const existing = cart.find(item => item.id === productId);
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
  if (item.qty <= 0) {
    cart = cart.filter(i => i.id !== productId);
  }

  updateCartUI();
}

// ===== 상품 제거 =====
function removeFromCart(productId) {
  cart = cart.filter(i => i.id !== productId);
  updateCartUI();
}

// ===== 장바구니 UI 업데이트 =====
function updateCartUI() {
  const totalQty = cart.reduce((sum, i) => sum + i.qty, 0);
  const totalPrice = cart.reduce((sum, i) => sum + i.salePrice * i.qty, 0);

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

// ===== 장바구니 패널 열기/닫기 =====
function toggleCart() {
  const panel = document.getElementById('cartPanel');
  const overlay = document.getElementById('cartOverlay');
  panel.classList.toggle('open');
  overlay.classList.toggle('open');
  document.body.style.overflow = panel.classList.contains('open') ? 'hidden' : '';
}

// ===== 주문하기 =====
function placeOrder() {
  if (cart.length === 0) {
    showToast('장바구니가 비어 있습니다.');
    return;
  }

  const total = cart.reduce((sum, i) => sum + i.salePrice * i.qty, 0);
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

// ===== 토스트 알림 =====
let toastTimer;
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ===== 헤더 스크롤 효과 =====
window.addEventListener('scroll', () => {
  const header = document.querySelector('.header');
  if (window.scrollY > 80) {
    header.style.background = 'rgba(27,94,32,1)';
  } else {
    header.style.background = 'rgba(27,94,32,.95)';
  }
});

// ===== 초기 렌더링 =====
renderProducts('전체');

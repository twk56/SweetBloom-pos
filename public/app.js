const state = { data: null, cart: new Map(), category: 'ทั้งหมด', staff: false, pendingView: null, currentOrderId: localStorage.getItem('sweetbloom.currentOrder'), trackingToken: localStorage.getItem('sweetbloom.trackingToken') };
const money = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 2 });
const statusLabel = { NEW: 'รอยืนยัน', CONFIRMED: 'ยืนยันแล้ว', BAKING: 'กำลังทำ', READY: 'พร้อมรับ', COMPLETED: 'เสร็จสิ้น', CANCELLED: 'ยกเลิกแล้ว' };

document.querySelectorAll('.nav-button').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
document.querySelector('#browseMenu').addEventListener('click', () => document.querySelector('#menuSection').scrollIntoView());
document.querySelector('#orderType').addEventListener('change', toggleDelivery);
document.querySelector('#orderForm').addEventListener('submit', submitOrder);
document.querySelector('#openMenuForm').addEventListener('click', () => document.querySelector('#menuDialog').showModal());
document.querySelector('[data-close]').addEventListener('click', () => document.querySelector('#menuDialog').close());
document.querySelector('#menuForm').addEventListener('submit', createMenu);
document.querySelector('#resetDemo').addEventListener('click', resetDemo);
document.querySelector('#staffForm').addEventListener('submit', loginStaff);
document.querySelector('[data-staff-close]').addEventListener('click', () => document.querySelector('#staffDialog').close());
document.querySelector('#logoutStaff').addEventListener('click', logoutStaff);
setInterval(() => document.querySelector('#clock').textContent = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }), 1000);
setDefaultFulfillment();

async function load() {
  try {
    const query = state.currentOrderId && state.trackingToken ? `?orderId=${encodeURIComponent(state.currentOrderId)}&trackingToken=${encodeURIComponent(state.trackingToken)}` : '';
    const response = await fetch(`/api/state${query}`);
    if (!response.ok) throw new Error('โหลดข้อมูลไม่สำเร็จ');
    state.data = await response.json();
    document.querySelector('#transferOption').disabled = !state.data.settings.promptPayEnabled;
    render();
  } catch (error) {
    toast(error.message);
  }
}

function render() {
  renderFilters();
  renderMenu();
  renderCart();
  renderTracking();
  renderKitchen();
  renderCashier();
  renderAdmin();
  document.querySelector('#kitchenBadge').textContent = state.data.orders.filter((order) => ['NEW', 'CONFIRMED', 'BAKING'].includes(order.status)).length;
  document.querySelector('#logoutStaff').hidden = !state.staff;
}

function renderFilters() {
  const categories = ['ทั้งหมด', ...new Set(state.data.menu.map((item) => item.category))];
  document.querySelector('#categoryFilters').innerHTML = categories.map((category) => `<button class="filter ${category === state.category ? 'active' : ''}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join('');
  document.querySelectorAll('[data-category]').forEach((button) => button.addEventListener('click', () => { state.category = button.dataset.category; renderFilters(); renderMenu(); }));
}

function renderMenu() {
  const menu = state.data.menu.filter((item) => state.category === 'ทั้งหมด' || item.category === state.category);
  const productImages = {
    'cake-strawberry': '/assets/images/hero/strawberry-cake.png',
    'cake-chocolate': '/assets/images/products/chocolate-ganache.png',
    'cake-matcha': '/assets/images/products/matcha-cake.png',
    'cake-blueberry': '/assets/images/products/blueberry-cheesecake.png'
  };
  document.querySelector('#menuGrid').innerHTML = menu.map((item) => `
    <article class="menu-card">
      <div class="menu-art" style="--card:${item.color}">${productImages[item.id] ? `<img src="${productImages[item.id]}" alt="${escapeHtml(item.name)}" loading="lazy">` : `<span class="cake-icon" aria-hidden="true">${item.category === 'เครื่องดื่ม' ? '🥤' : '🍰'}</span>`}</div>
      <div class="menu-body">
        <div class="menu-meta"><span>${escapeHtml(item.category)}</span><span>${item.available && item.stock > 0 ? `เหลือ ${item.stock}` : 'หมด'}</span></div>
        <h3>${escapeHtml(item.name)}</h3>
        <div class="menu-action"><strong>${money.format(item.price)}</strong><button class="add-button" data-add="${item.id}" aria-label="เพิ่ม ${escapeHtml(item.name)}" ${!item.available || item.stock <= 0 ? 'disabled' : ''}>+</button></div>
      </div>
    </article>`).join('');
  document.querySelectorAll('[data-add]').forEach((button) => button.addEventListener('click', () => addToCart(button.dataset.add)));
}

function addToCart(id) {
  const item = state.data.menu.find((entry) => entry.id === id);
  const current = state.cart.get(id) || { quantity: 0, note: '' };
  if (current.quantity >= item.stock) return toast('จำนวนในตะกร้าถึงสต็อกที่มีแล้ว');
  state.cart.set(id, { ...current, quantity: current.quantity + 1 });
  renderCart();
}

function renderCart() {
  const entries = [...state.cart.entries()];
  document.querySelector('#cartCount').textContent = `${entries.reduce((sum, [, line]) => sum + line.quantity, 0)} รายการ`;
  document.querySelector('#cartItems').innerHTML = entries.length ? entries.map(([id, line]) => {
    const item = state.data.menu.find((entry) => entry.id === id);
    if (!item) return '';
    return `<div class="cart-item"><strong>${escapeHtml(item.name)}</strong><strong>${money.format(item.price * line.quantity)}</strong><small>${money.format(item.price)} / ชิ้น</small><div class="qty"><button data-qty="${id}" data-delta="-1" aria-label="ลดจำนวน">−</button><span>${line.quantity}</span><button data-qty="${id}" data-delta="1" aria-label="เพิ่มจำนวน">+</button><button class="remove" data-remove="${id}">นำออก</button></div><input class="item-note" data-note="${id}" maxlength="120" value="${escapeHtml(line.note || '')}" placeholder="ข้อความบนเค้ก / แพ้อาหาร / หมายเหตุ"></div>`;
  }).join('') : '<div class="cart-empty">ยังไม่มีสินค้า<br>กด + ที่เมนูเพื่อเริ่มออเดอร์</div>';
  document.querySelectorAll('[data-qty]').forEach((button) => button.addEventListener('click', () => changeQty(button.dataset.qty, Number(button.dataset.delta))));
  document.querySelectorAll('[data-remove]').forEach((button) => button.addEventListener('click', () => { state.cart.delete(button.dataset.remove); renderCart(); }));
  document.querySelectorAll('[data-note]').forEach((input) => input.addEventListener('input', () => {
    const line = state.cart.get(input.dataset.note);
    if (line) state.cart.set(input.dataset.note, { ...line, note: input.value.slice(0, 120) });
  }));
  const subtotal = entries.reduce((sum, [id, line]) => sum + (state.data.menu.find((item) => item.id === id)?.price || 0) * line.quantity, 0);
  const tax = Math.round(subtotal * .07 * 100) / 100;
  const isDelivery = document.querySelector('#orderType').value === 'DELIVERY';
  const deliveryFee = isDelivery ? Number(state.data.settings.deliveryFee || 0) : 0;
  document.querySelector('#subtotal').textContent = money.format(subtotal);
  document.querySelector('#tax').textContent = money.format(tax);
  document.querySelector('#deliveryFeeLabel').hidden = !isDelivery;
  document.querySelector('#deliveryFee').hidden = !isDelivery;
  document.querySelector('#deliveryFee').textContent = money.format(deliveryFee);
  document.querySelector('#total').textContent = money.format(subtotal + tax + deliveryFee);
  document.querySelector('#submitOrder').disabled = entries.length === 0;
}

function changeQty(id, delta) {
  const line = state.cart.get(id);
  const item = state.data.menu.find((entry) => entry.id === id);
  if (!line || !item) return;
  const quantity = line.quantity + delta;
  if (quantity <= 0) state.cart.delete(id);
  else if (quantity <= item.stock) state.cart.set(id, { ...line, quantity });
  else toast('สต็อกไม่พอ');
  renderCart();
}

async function submitOrder(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const button = document.querySelector('#submitOrder');
  button.disabled = true;
  button.textContent = 'กำลังส่ง…';
  try {
    const order = await api('/api/orders', { method: 'POST', body: JSON.stringify({
      customerName: form.get('customerName'), phone: form.get('phone'), orderType: form.get('orderType'), address: form.get('address'), fulfillmentAt: form.get('fulfillmentAt'), paymentMethod: form.get('paymentMethod'),
      idempotencyKey: crypto.randomUUID(), items: [...state.cart.entries()].map(([menuItemId, line]) => ({ menuItemId, ...line }))
    }) });
    state.cart.clear();
    state.currentOrderId = order.id;
    state.trackingToken = order.trackingToken;
    localStorage.setItem('sweetbloom.currentOrder', order.id);
    localStorage.setItem('sweetbloom.trackingToken', order.trackingToken);
    formElement.reset();
    setDefaultFulfillment();
    toggleDelivery();
    toast(`ส่งออเดอร์ ${order.orderNo} แล้ว`);
    await load();
    document.querySelector('#trackingPanel').scrollIntoView({ behavior: 'smooth' });
  } catch (error) { toast(error.message); }
  finally { button.textContent = 'ส่งออเดอร์เข้าครัว'; renderCart(); }
}

function renderTracking() {
  const panel = document.querySelector('#trackingPanel');
  const order = state.data.orders.find((entry) => entry.id === state.currentOrderId);
  if (!order) return panel.hidden = true;
  panel.hidden = false;
  const flow = ['NEW', 'CONFIRMED', 'BAKING', 'READY', 'COMPLETED'];
  const index = flow.indexOf(order.status);
  const paymentText = order.paymentStatus === 'PAID' ? 'ชำระแล้ว' : order.paymentStatus === 'PENDING' ? 'รอตรวจสอบยอดโอน' : 'รอชำระ';
  panel.innerHTML = `<div class="section-head"><div><p class="eyebrow dark">ติดตามออเดอร์</p><h2>${order.orderNo} • ${escapeHtml(order.customerName)}</h2><p>นัดรับ ${formatDate(order.fulfillmentAt)} · ${order.orderType === 'DELIVERY' ? 'จัดส่ง' : 'รับหน้าร้าน'}</p></div><span class="status-pill ${order.paymentStatus === 'PAID' ? 'paid' : ''}">${statusLabel[order.status]} · ${paymentText}</span></div>${order.paymentMethod === 'TRANSFER' && state.data.settings.promptPayId ? `<p><strong>โอน PromptPay:</strong> ${escapeHtml(state.data.settings.promptPayId)} จำนวน ${money.format(order.total)} แล้วแจ้งร้านเพื่อตรวจสอบ</p>` : ''}<div class="progress">${flow.map((_, step) => `<span class="step ${step <= index ? 'done' : ''}"></span>`).join('')}</div>${['NEW', 'CONFIRMED'].includes(order.status) && order.paymentStatus !== 'PAID' ? `<button class="secondary danger" data-cancel-order="${order.id}">ยกเลิกออเดอร์</button>` : ''}`;
  document.querySelector('[data-cancel-order]')?.addEventListener('click', cancelOrder);
}

function renderKitchen() {
  const lanes = [
    ['NEW', 'ออเดอร์ใหม่', 'ยืนยันออเดอร์'],
    ['CONFIRMED', 'รอทำ', 'เริ่มทำ'],
    ['BAKING', 'กำลังทำ', 'ทำเสร็จแล้ว'],
    ['READY', 'พร้อมรับ', 'ส่งมอบแล้ว']
  ];
  document.querySelector('#kitchenBoard').innerHTML = lanes.map(([status, title, action]) => {
    const orders = state.data.orders.filter((order) => order.status === status);
    return `<section class="lane"><div class="lane-head"><h2>${title}</h2><span>${orders.length}</span></div>${orders.length ? orders.map((order) => ticket(order, action)).join('') : '<div class="empty">ไม่มีคิว</div>'}</section>`;
  }).join('');
  document.querySelectorAll('[data-next-status]').forEach((button) => button.addEventListener('click', () => updateStatus(button.dataset.orderId, button.dataset.nextStatus)));
  document.querySelectorAll('[data-ai-review]').forEach((button) => button.addEventListener('click', () => reviewWithJev(button.dataset.aiReview)));
}

function ticket(order, action) {
  const next = { NEW: 'CONFIRMED', CONFIRMED: 'BAKING', BAKING: 'READY', READY: 'COMPLETED' }[order.status];
  const disabled = next === 'COMPLETED' && order.paymentStatus !== 'PAID';
  const ai = order.aiReview;
  const jev = ai ? `<div class="jev-review"><strong>Jev: ${escapeHtml(ai.priority || 'ตรวจแล้ว')}</strong><span>ความซับซ้อน ${escapeHtml(ai.complexity ?? '-')} / 10</span></div>` : `<button class="jev-button" data-ai-review="${order.id}" ${state.data.settings.jevEnabled ? '' : 'disabled title="ตั้งค่า JEV_AI_API_KEY ก่อน"'}>${state.data.settings.jevEnabled ? 'วิเคราะห์ด้วย Jev' : 'Jev ยังไม่เชื่อม'}</button>`;
  return `<article class="ticket ${order.status === 'READY' ? 'ready' : ''}"><div class="ticket-top"><h3>${order.orderNo}</h3><time>${age(order.createdAt)}</time></div><small>${escapeHtml(order.customerName)} · ${escapeHtml(order.phone)} · ${order.orderType === 'DELIVERY' ? 'จัดส่ง' : 'รับหน้าร้าน'} · ${formatDate(order.fulfillmentAt)}</small><ul>${order.items.map((item) => `<li>${item.quantity}× ${escapeHtml(item.name)}${item.note ? ` — ${escapeHtml(item.note)}` : ''}</li>`).join('')}</ul>${order.address ? `<p>${escapeHtml(order.address)}</p>` : ''}${jev}<button class="primary" data-order-id="${order.id}" data-next-status="${next}" ${disabled ? 'disabled title="รอชำระเงิน"' : ''}>${disabled ? 'รอชำระก่อนส่งมอบ' : action}</button></article>`;
}

async function reviewWithJev(orderId) {
  try { await api(`/api/orders/${orderId}/ai-review`, { method: 'POST' }); toast('Jev วิเคราะห์ออเดอร์แล้ว'); await load(); }
  catch (error) { toast(error.message); }
}

async function updateStatus(orderId, status) {
  try { await api(`/api/orders/${orderId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); toast(`อัปเดตเป็น ${statusLabel[status]}`); await load(); }
  catch (error) { toast(error.message); }
}

function renderCashier() {
  const orders = state.data.orders.filter((order) => order.status !== 'CANCELLED' && (order.status !== 'COMPLETED' || order.paymentStatus === 'PAID')).slice(0, 12);
  document.querySelector('#unpaidCount').textContent = state.data.orders.filter((order) => order.paymentStatus === 'UNPAID').length;
  document.querySelector('#cashierGrid').innerHTML = orders.length ? orders.map((order) => `<article class="bill ${order.paymentStatus === 'PAID' ? 'paid' : ''}"><div class="ticket-top"><div><h3>${order.orderNo}</h3><small>${escapeHtml(order.customerName)} · ${statusLabel[order.status]}</small></div><span class="status-pill ${order.paymentStatus === 'PAID' ? 'paid' : ''}">${order.paymentStatus === 'PAID' ? 'ชำระแล้ว' : 'รอชำระ'}</span></div><div class="bill-lines">${order.items.map((item) => `${item.quantity}× ${escapeHtml(item.name)}`).join('<br>')}</div><div class="bill-total"><span>ยอดสุทธิ</span><strong>${money.format(order.total)}</strong></div>${order.paymentStatus === 'UNPAID' ? `<div class="pay-actions"><select aria-label="วิธีชำระ" id="method-${order.id}"><option value="CASH">เงินสด</option><option value="QR">QR</option><option value="CARD">บัตร</option></select><button class="primary" data-pay="${order.id}" data-amount="${order.total}">รับชำระ</button></div>` : ''}</article>`).join('') : '<div class="empty">ยังไม่มีออเดอร์</div>';
  document.querySelectorAll('[data-pay]').forEach((button) => button.addEventListener('click', () => pay(button.dataset.pay, Number(button.dataset.amount))));
}

async function pay(orderId, amount) {
  const method = document.querySelector(`#method-${CSS.escape(orderId)}`).value;
  try { const payment = await api(`/api/orders/${orderId}/payments`, { method: 'POST', body: JSON.stringify({ method, amount, idempotencyKey: crypto.randomUUID() }) }); toast(`รับชำระแล้ว ใบเสร็จ ${payment.receiptNo}`); await load(); }
  catch (error) { toast(error.message); }
}

function renderAdmin() {
  const s = state.data.summary;
  document.querySelector('#metrics').innerHTML = [
    ['ยอดขายวันนี้', money.format(s.salesToday)], ['ออเดอร์ที่ชำระ', `${s.paidOrders} รายการ`], ['คิวที่ยังเปิด', `${s.openOrders} คิว`], ['สต็อกใกล้หมด', `${s.lowStock} เมนู`]
  ].map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join('');
  document.querySelector('#adminMenu').innerHTML = state.data.menu.map((item) => `<div class="menu-row"><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category)}</small></div><label class="compact-field">ราคา<input type="number" min="1" step="1" value="${item.price}" data-price="${item.id}" aria-label="ราคา ${escapeHtml(item.name)}"></label><label class="compact-field">สต็อก<input type="number" min="0" step="1" value="${item.stock}" data-stock="${item.id}" aria-label="สต็อก ${escapeHtml(item.name)}"></label><span>${item.stock <= 5 ? 'ใกล้หมด' : 'พร้อมขาย'}</span><button class="toggle ${item.available ? '' : 'off'}" data-toggle="${item.id}" data-available="${item.available}">${item.available ? 'เปิดขาย' : 'ปิดขาย'}</button></div>`).join('');
  document.querySelectorAll('[data-price]').forEach((input) => input.addEventListener('change', () => updateMenu(input.dataset.price, { price: Number(input.value) })));
  document.querySelectorAll('[data-stock]').forEach((input) => input.addEventListener('change', () => updateMenu(input.dataset.stock, { stock: Number(input.value) })));
  document.querySelectorAll('[data-toggle]').forEach((button) => button.addEventListener('click', () => updateMenu(button.dataset.toggle, { available: button.dataset.available !== 'true' })));
  document.querySelector('#auditList').innerHTML = state.data.audit.slice(0, 15).map((entry) => `<div class="audit-item"><div></div><div><p>${auditText(entry)}</p><small>${new Date(entry.createdAt).toLocaleString('th-TH')}</small></div></div>`).join('') || '<div class="empty">ยังไม่มีกิจกรรม</div>';
}

async function updateMenu(id, payload) {
  try { await api(`/api/menu/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }); toast('บันทึกเมนูแล้ว'); await load(); }
  catch (error) { toast(error.message); }
}

async function createMenu(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  try { await api('/api/menu', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) }); document.querySelector('#menuDialog').close(); formElement.reset(); toast('เพิ่มเมนูแล้ว'); await load(); }
  catch (error) { toast(error.message); }
}

async function resetDemo() {
  if (!confirm('รีเซ็ตออเดอร์ ยอดขาย และเมนูกลับเป็นข้อมูลเริ่มต้นหรือไม่?')) return;
  try { await api('/api/reset', { method: 'POST' }); state.cart.clear(); localStorage.removeItem('sweetbloom.currentOrder'); state.currentOrderId = null; toast('รีเซ็ตข้อมูลแล้ว'); await load(); }
  catch (error) { toast(error.message); }
}

async function switchView(view) {
  if (view !== 'shop' && !state.staff) {
    state.pendingView = view;
    document.querySelector('#staffDialog').showModal();
    return;
  }
  document.querySelectorAll('.view').forEach((section) => section.classList.toggle('active', section.id === `${view}View`));
  document.querySelectorAll('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loginStaff(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api('/api/auth', { method: 'POST', body: JSON.stringify({ pin: new FormData(form).get('pin') }) });
    state.staff = true;
    form.reset();
    document.querySelector('#staffDialog').close();
    await load();
    switchView(state.pendingView || 'kitchen');
    state.pendingView = null;
  } catch (error) { toast(error.message); }
}

async function logoutStaff() {
  await api('/api/auth', { method: 'DELETE' });
  state.staff = false;
  switchView('shop');
  await load();
  toast('ออกจากระบบแล้ว');
}

async function cancelOrder() {
  if (!confirm('ยกเลิกออเดอร์นี้และคืนสต็อกหรือไม่?')) return;
  try {
    await api(`/api/orders/${state.currentOrderId}/cancel`, { method: 'POST', body: JSON.stringify({ trackingToken: state.trackingToken }) });
    toast('ยกเลิกออเดอร์แล้ว');
    await load();
  } catch (error) { toast(error.message); }
}

function toggleDelivery() {
  const delivery = document.querySelector('#orderType').value === 'DELIVERY';
  const field = document.querySelector('#addressField');
  field.hidden = !delivery;
  field.querySelector('textarea').required = delivery;
  if (state.data) renderCart();
}

function setDefaultFulfillment() {
  const input = document.querySelector('#fulfillmentAt');
  const date = new Date(Date.now() + 60 * 60_000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  input.min = new Date(Date.now() + 15 * 60_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  input.value = local;
}

function formatDate(value) {
  return new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'content-type': 'application/json', ...options.headers }, ...options });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'ทำรายการไม่สำเร็จ');
  return payload;
}

function age(date) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
  return minutes < 1 ? 'เมื่อครู่' : `${minutes} นาที`;
}

function auditText(entry) {
  const labels = { ORDER_CREATED: 'สร้างออเดอร์ใหม่', ORDER_STATUS_CHANGED: 'อัปเดตสถานะออเดอร์', PAYMENT_CAPTURED: 'บันทึกการชำระเงิน', MENU_CREATED: 'เพิ่มเมนู', MENU_UPDATED: 'แก้ไขเมนู', JEV_ORDER_REVIEWED: 'Jev วิเคราะห์ออเดอร์' };
  return `${labels[entry.action] || entry.action} · ${escapeHtml(entry.detail || '')}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

let toastTimer;
function toast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 3200);
}

const events = new EventSource('/api/events');
events.addEventListener('state', load);
events.onerror = () => document.querySelector('.live-indicator').innerHTML = '<span></span> กำลังเชื่อมต่อใหม่';
events.onopen = () => document.querySelector('.live-indicator').innerHTML = '<span></span> เชื่อมต่อแล้ว';
fetch('/api/session').then((response) => response.json()).then((session) => { state.staff = session.staff; return load(); }).catch(load);

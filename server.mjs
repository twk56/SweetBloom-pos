import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { CakeStore } from './src/store.mjs';
import { reviewOrderWithJev } from './src/jev.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(root, 'public');
const store = new CakeStore(join(root, 'data', 'store.json'));
const clients = new Set();
const sessions = new Map();
const staffPin = process.env.STAFF_PIN || '2468';
const promptPayId = String(process.env.PROMPTPAY_ID || '').trim();
const jevApiKey = String(process.env.JEV_AI_API_KEY || '').trim();
await store.init();

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json'
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/health') return json(res, 200, { ok: true, time: new Date().toISOString() });
    if (url.pathname === '/api/events' && req.method === 'GET') return events(req, res);
    if (url.pathname === '/api/session' && req.method === 'GET') return json(res, 200, { staff: isStaff(req) });
    if (url.pathname === '/api/auth' && req.method === 'POST') return login(req, res);
    if (url.pathname === '/api/auth' && req.method === 'DELETE') return logout(req, res);
    if (url.pathname === '/api/state' && req.method === 'GET') {
      const snapshot = store.snapshot();
      return json(res, 200, isStaff(req) ? staffState(snapshot) : publicState(snapshot, url));
    }
    if (url.pathname === '/api/reports/orders.csv' && req.method === 'GET') {
      requireStaff(req);
      return csv(res, store.snapshot());
    }

    if (url.pathname === '/api/orders' && req.method === 'POST') {
      const input = await body(req);
      if (input.paymentMethod === 'TRANSFER' && !promptPayId) throw Object.assign(new Error('ร้านยังไม่ได้ตั้งค่า PromptPay'), { status: 400 });
      const order = await store.createOrder(input);
      broadcast('state');
      scheduleAiReview(order.id);
      return json(res, 201, { ...order, idempotencyKey: undefined });
    }

    const cancelMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/cancel$/);
    if (cancelMatch && req.method === 'POST') {
      const input = await body(req);
      const order = await store.cancelOrder(cancelMatch[1], input.trackingToken, isStaff(req) ? 'STAFF' : 'CUSTOMER');
      broadcast('state');
      return json(res, 200, order);
    }

    const statusMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
    if (statusMatch && req.method === 'PATCH') {
      requireStaff(req);
      const order = await store.updateOrderStatus(statusMatch[1], (await body(req)).status);
      broadcast('state');
      return json(res, 200, order);
    }

    const paymentMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/payments$/);
    if (paymentMatch && req.method === 'POST') {
      requireStaff(req);
      const payment = await store.payOrder(paymentMatch[1], await body(req));
      broadcast('state');
      return json(res, 201, payment);
    }

    const aiReviewMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/ai-review$/);
    if (aiReviewMatch && req.method === 'POST') {
      requireStaff(req);
      if (!jevApiKey) throw Object.assign(new Error('ยังไม่ได้ตั้งค่า JEV_AI_API_KEY'), { status: 503 });
      const order = store.snapshot().orders.find((entry) => entry.id === aiReviewMatch[1]);
      if (!order) throw Object.assign(new Error('ไม่พบออเดอร์'), { status: 404 });
      const review = await reviewOrderWithJev(order, { apiKey: jevApiKey });
      await store.setOrderAiReview(order.id, review);
      broadcast('state');
      return json(res, 200, review);
    }

    if (url.pathname === '/api/menu' && req.method === 'POST') {
      requireStaff(req);
      const item = await store.createMenuItem(await body(req));
      broadcast('state');
      return json(res, 201, item);
    }

    const menuMatch = url.pathname.match(/^\/api\/menu\/([^/]+)$/);
    if (menuMatch && req.method === 'PATCH') {
      requireStaff(req);
      const item = await store.updateMenuItem(menuMatch[1], await body(req));
      broadcast('state');
      return json(res, 200, item);
    }

    if (url.pathname === '/api/reset' && req.method === 'POST') {
      requireStaff(req);
      await store.reset();
      broadcast('state');
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' || req.method === 'HEAD') return staticFile(url.pathname, req, res);
    json(res, 404, { error: 'ไม่พบเส้นทางที่ร้องขอ' });
  } catch (error) {
    console.error(error);
    json(res, error.status || 500, { error: error.status ? error.message : 'ระบบขัดข้อง กรุณาลองใหม่' });
  }
});

function summarize(state) {
  const today = new Date().toISOString().slice(0, 10);
  const paidToday = state.payments.filter((payment) => payment.createdAt.startsWith(today));
  return {
    ...state,
    summary: {
      salesToday: paidToday.reduce((sum, payment) => sum + payment.amount, 0),
      paidOrders: paidToday.length,
      openOrders: state.orders.filter((order) => order.status !== 'COMPLETED').length,
      lowStock: state.menu.filter((item) => item.stock <= 5).length
    }
  };
}

function staffState(state) {
  const result = summarize(state);
  result.settings.jevEnabled = Boolean(jevApiKey);
  return result;
}

function publicState(state, url) {
  const orderId = url.searchParams.get('orderId');
  const trackingToken = url.searchParams.get('trackingToken');
  const order = state.orders.find((entry) => entry.id === orderId && entry.trackingToken === trackingToken);
  const safeOrder = order ? (({ idempotencyKey, trackingToken: _trackingToken, aiReview, ...rest }) => rest)(order) : null;
  return {
    settings: {
      shopName: state.settings.shopName,
      currency: state.settings.currency,
      taxRate: state.settings.taxRate,
      deliveryFee: state.settings.deliveryFee,
      promptPayEnabled: Boolean(promptPayId),
      promptPayId: order?.paymentMethod === 'TRANSFER' ? promptPayId : ''
    },
    menu: state.menu.filter((item) => item.available),
    orders: safeOrder ? [safeOrder] : [],
    payments: [],
    audit: [],
    summary: { salesToday: 0, paidOrders: 0, openOrders: 0, lowStock: 0 }
  };
}

function scheduleAiReview(orderId) {
  if (!jevApiKey) return;
  const order = store.snapshot().orders.find((entry) => entry.id === orderId);
  if (!order) return;
  reviewOrderWithJev(order, { apiKey: jevApiKey })
    .then((review) => store.setOrderAiReview(orderId, review))
    .then(() => broadcast('state'))
    .catch((error) => console.error('Jev review failed:', error.message));
}

async function login(req, res) {
  const input = await body(req);
  const supplied = Buffer.from(String(input.pin || ''));
  const expected = Buffer.from(staffPin);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw Object.assign(new Error('PIN ไม่ถูกต้อง'), { status: 401 });
  }
  const token = randomUUID();
  sessions.set(token, Date.now() + 12 * 60 * 60_000);
  return json(res, 200, { staff: true }, { 'set-cookie': `sweetbloom_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` });
}

function logout(req, res) {
  const token = parseCookies(req).sweetbloom_session;
  if (token) sessions.delete(token);
  return json(res, 200, { staff: false }, { 'set-cookie': 'sweetbloom_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
}

function isStaff(req) {
  const token = parseCookies(req).sweetbloom_session;
  const expiresAt = token ? sessions.get(token) : 0;
  if (!expiresAt || expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return false;
  }
  return true;
}

function requireStaff(req) {
  if (!isStaff(req)) throw Object.assign(new Error('กรุณาเข้าสู่ระบบพนักงาน'), { status: 401 });
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw Object.assign(new Error('ข้อมูลใหญ่เกินไป'), { status: 413 });
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw Object.assign(new Error('JSON ไม่ถูกต้อง'), { status: 400 });
  }
}

function json(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...securityHeaders(),
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function events(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  });
  res.write('event: connected\ndata: {}\n\n');
  clients.add(res);
  const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
}

function broadcast(type) {
  for (const client of clients) client.write(`event: ${type}\ndata: {"at":"${new Date().toISOString()}"}\n\n`);
}

async function staticFile(pathname, req, res) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const safe = normalize(relative).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(publicDir, safe);
  if (!filePath.startsWith(publicDir)) return json(res, 403, { error: 'ไม่อนุญาต' });
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not file');
    const data = await readFile(filePath);
    res.writeHead(200, {
      'content-type': mime[extname(filePath)] || 'application/octet-stream',
      'cache-control': ['.png', '.svg'].includes(extname(filePath)) ? 'public, max-age=86400' : 'no-cache',
      ...securityHeaders()
    });
    if (req.method === 'HEAD') return res.end();
    res.end(data);
  } catch {
    json(res, 404, { error: 'ไม่พบไฟล์' });
  }
}

function csv(res, state) {
  const rows = [['order_no', 'created_at', 'customer', 'phone', 'type', 'fulfillment_at', 'status', 'payment_status', 'subtotal', 'tax', 'delivery_fee', 'total']];
  for (const order of state.orders) {
    rows.push([order.orderNo, order.createdAt, order.customerName, order.phone, order.orderType, order.fulfillmentAt, order.status, order.paymentStatus, order.subtotal, order.tax, order.deliveryFee, order.total]);
  }
  const content = '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="sweetbloom-orders-${new Date().toISOString().slice(0, 10)}.csv"`,
    'cache-control': 'no-store',
    ...securityHeaders()
  });
  res.end(content);
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function securityHeaders() {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  };
}

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '::';
server.listen(port, host, () => {
  console.log(`SweetBloom พร้อมใช้งานที่ http://localhost:${port}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

export { server };

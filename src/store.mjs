import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const STATUS_FLOW = ['NEW', 'CONFIRMED', 'BAKING', 'READY', 'COMPLETED'];

export function makeSeed() {
  return {
    settings: {
      shopName: 'SweetBloom',
      currency: 'THB',
      taxRate: 0.07,
      deliveryFee: 60,
      updatedAt: new Date().toISOString()
    },
    menu: [
      { id: 'cake-strawberry', name: 'สตรอว์เบอร์รีชอร์ตเค้ก', category: 'เค้กปอนด์', price: 690, stock: 8, available: true, color: '#c83f63', featured: true },
      { id: 'cake-chocolate', name: 'ดาร์กช็อกโกแลตกานาช', category: 'เค้กปอนด์', price: 750, stock: 6, available: true, color: '#5a3327' },
      { id: 'cake-lemon', name: 'เลมอนชีสเค้ก', category: 'ชีสเค้ก', price: 145, stock: 14, available: true, color: '#d5a928' },
      { id: 'cake-matcha', name: 'มัทฉะถั่วแดง', category: 'เค้กชิ้น', price: 155, stock: 10, available: true, color: '#4f7149' },
      { id: 'cake-carrot', name: 'แครอตเค้กครีมชีส', category: 'เค้กชิ้น', price: 135, stock: 9, available: true, color: '#c97035' },
      { id: 'cake-blueberry', name: 'บลูเบอร์รีชีสเค้ก', category: 'ชีสเค้ก', price: 165, stock: 12, available: true, color: '#5a59a8' },
      { id: 'drink-tea', name: 'ชาพีชโฮมเมด', category: 'เครื่องดื่ม', price: 85, stock: 20, available: true, color: '#e58d65' },
      { id: 'drink-cocoa', name: 'โกโก้เย็น', category: 'เครื่องดื่ม', price: 95, stock: 18, available: true, color: '#704238' }
    ],
    orders: [],
    payments: [],
    audit: []
  };
}

export class CakeStore {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.memory = options.memory ?? false;
    this.state = options.seed ? structuredClone(options.seed) : null;
    this.queue = Promise.resolve();
  }

  async init() {
    if (this.state) return this.snapshot();
    try {
      this.state = JSON.parse(await readFile(this.filePath, 'utf8'));
      this.state.settings = { ...makeSeed().settings, ...this.state.settings };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.state = makeSeed();
      await this.persist();
    }
    return this.snapshot();
  }

  snapshot() {
    return structuredClone(this.state);
  }

  async persist() {
    this.state.settings.updatedAt = new Date().toISOString();
    if (this.memory) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  transact(work) {
    const task = this.queue.then(async () => {
      const result = await work(this.state);
      await this.persist();
      return structuredClone(result);
    });
    this.queue = task.catch(() => {});
    return task;
  }

  async createOrder(input) {
    return this.transact((state) => {
      const name = String(input.customerName || '').trim().slice(0, 60);
      const phone = String(input.phone || '').replace(/[^0-9+]/g, '').slice(0, 16);
      const idempotencyKey = String(input.idempotencyKey || '').trim();
      if (!name) throw businessError('กรุณาระบุชื่อลูกค้า', 400);
      if (!/^\+?[0-9]{8,15}$/.test(phone)) throw businessError('กรุณาระบุเบอร์โทรที่ติดต่อได้', 400);
      if (!idempotencyKey) throw businessError('ไม่พบรหัสป้องกันรายการซ้ำ', 400);
      const duplicate = state.orders.find((order) => order.idempotencyKey === idempotencyKey);
      if (duplicate) return duplicate;
      if (!Array.isArray(input.items) || input.items.length === 0) throw businessError('ตะกร้ายังว่าง', 400);

      const lines = input.items.map((line) => {
        const menuItem = state.menu.find((item) => item.id === line.menuItemId && item.available);
        const quantity = Number(line.quantity);
        if (!menuItem) throw businessError('มีเมนูที่ไม่พร้อมขาย กรุณาโหลดข้อมูลใหม่', 409);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw businessError('จำนวนสินค้าไม่ถูกต้อง', 400);
        if (menuItem.stock < quantity) throw businessError(`${menuItem.name} เหลือเพียง ${menuItem.stock} รายการ`, 409);
        return {
          id: randomUUID(),
          menuItemId: menuItem.id,
          name: menuItem.name,
          quantity,
          unitPrice: menuItem.price,
          note: String(line.note || '').trim().slice(0, 120)
        };
      });

      const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
      const tax = Math.round(subtotal * state.settings.taxRate * 100) / 100;
      const orderType = input.orderType === 'DELIVERY' ? 'DELIVERY' : 'PICKUP';
      const address = orderType === 'DELIVERY' ? String(input.address || '').trim().slice(0, 300) : '';
      if (orderType === 'DELIVERY' && address.length < 10) throw businessError('กรุณาระบุที่อยู่จัดส่งให้ครบถ้วน', 400);
      const fulfillmentAt = new Date(input.fulfillmentAt);
      const nowMs = Date.now();
      if (Number.isNaN(fulfillmentAt.getTime()) || fulfillmentAt.getTime() < nowMs + 15 * 60_000 || fulfillmentAt.getTime() > nowMs + 30 * 86_400_000) {
        throw businessError('เวลารับสินค้าต้องล่วงหน้าอย่างน้อย 15 นาทีและไม่เกิน 30 วัน', 400);
      }
      const deliveryFee = orderType === 'DELIVERY' ? state.settings.deliveryFee : 0;
      const paymentMethod = input.paymentMethod === 'TRANSFER' ? 'TRANSFER' : 'PAY_AT_SHOP';
      const now = new Date().toISOString();
      for (const line of lines) state.menu.find((item) => item.id === line.menuItemId).stock -= line.quantity;
      const order = {
        id: randomUUID(),
        trackingToken: randomUUID(),
        orderNo: nextOrderNo(state.orders),
        idempotencyKey,
        customerName: name,
        phone,
        orderType,
        address,
        fulfillmentAt: fulfillmentAt.toISOString(),
        paymentMethod,
        items: lines,
        subtotal,
        tax,
        deliveryFee,
        total: subtotal + tax + deliveryFee,
        status: 'NEW',
        paymentStatus: paymentMethod === 'TRANSFER' ? 'PENDING' : 'UNPAID',
        createdAt: now,
        updatedAt: now
      };
      state.orders.unshift(order);
      addAudit(state, 'ORDER_CREATED', order.id, name);
      return order;
    });
  }

  async updateOrderStatus(orderId, status) {
    return this.transact((state) => {
      const order = findOrder(state, orderId);
      const currentIndex = STATUS_FLOW.indexOf(order.status);
      const nextIndex = STATUS_FLOW.indexOf(status);
      if (nextIndex !== currentIndex + 1) throw businessError('เปลี่ยนสถานะได้ทีละขั้นเท่านั้น', 409);
      if (status === 'COMPLETED' && order.paymentStatus !== 'PAID') throw businessError('ต้องรับชำระก่อนปิดออเดอร์', 409);
      order.status = status;
      order.updatedAt = new Date().toISOString();
      addAudit(state, 'ORDER_STATUS_CHANGED', order.id, status);
      return order;
    });
  }

  async setOrderAiReview(orderId, review) {
    return this.transact((state) => {
      const order = findOrder(state, orderId);
      order.aiReview = review;
      order.updatedAt = new Date().toISOString();
      addAudit(state, 'JEV_ORDER_REVIEWED', order.id, `${review.priority}:${review.confidence}`);
      return order;
    });
  }

  async cancelOrder(orderId, trackingToken, actor = 'CUSTOMER') {
    return this.transact((state) => {
      const order = findOrder(state, orderId);
      if (actor === 'CUSTOMER' && order.trackingToken !== trackingToken) throw businessError('ไม่อนุญาตให้ยกเลิกออเดอร์นี้', 403);
      if (!['NEW', 'CONFIRMED'].includes(order.status)) throw businessError('ออเดอร์เริ่มทำแล้ว กรุณาติดต่อร้าน', 409);
      if (order.paymentStatus === 'PAID') throw businessError('รายการชำระแล้ว กรุณาติดต่อร้านเพื่อคืนเงิน', 409);
      for (const line of order.items) {
        const menuItem = state.menu.find((item) => item.id === line.menuItemId);
        if (menuItem) menuItem.stock += line.quantity;
      }
      order.status = 'CANCELLED';
      order.updatedAt = new Date().toISOString();
      addAudit(state, 'ORDER_CANCELLED', order.id, actor);
      return order;
    });
  }

  async payOrder(orderId, input) {
    return this.transact((state) => {
      const order = findOrder(state, orderId);
      if (order.paymentStatus === 'PAID') throw businessError('ออเดอร์นี้ชำระแล้ว', 409);
      const idempotencyKey = String(input.idempotencyKey || '').trim();
      const duplicate = state.payments.find((payment) => payment.idempotencyKey === idempotencyKey);
      if (duplicate) return duplicate;
      const method = ['CASH', 'CARD', 'QR'].includes(input.method) ? input.method : 'CASH';
      const amount = Number(input.amount);
      if (!Number.isFinite(amount) || amount !== order.total) throw businessError('ยอดชำระต้องเท่ากับยอดสุทธิ', 400);
      const payment = {
        id: randomUUID(),
        receiptNo: `SB${Date.now().toString().slice(-10)}`,
        orderId: order.id,
        orderNo: order.orderNo,
        method,
        amount,
        idempotencyKey,
        createdAt: new Date().toISOString()
      };
      state.payments.unshift(payment);
      order.paymentStatus = 'PAID';
      order.updatedAt = new Date().toISOString();
      addAudit(state, 'PAYMENT_CAPTURED', order.id, method);
      return payment;
    });
  }

  async createMenuItem(input) {
    return this.transact((state) => {
      const name = String(input.name || '').trim().slice(0, 80);
      const price = Number(input.price);
      const stock = Number(input.stock);
      if (!name || !Number.isFinite(price) || price <= 0 || !Number.isInteger(stock) || stock < 0) {
        throw businessError('ข้อมูลเมนูไม่ถูกต้อง', 400);
      }
      const item = {
        id: randomUUID(),
        name,
        category: String(input.category || 'เค้ก').trim().slice(0, 40),
        price: Math.round(price * 100) / 100,
        stock,
        available: true,
        color: '#8b3153'
      };
      state.menu.push(item);
      addAudit(state, 'MENU_CREATED', item.id, item.name);
      return item;
    });
  }

  async updateMenuItem(itemId, input) {
    return this.transact((state) => {
      const item = state.menu.find((entry) => entry.id === itemId);
      if (!item) throw businessError('ไม่พบเมนู', 404);
      if (typeof input.available === 'boolean') item.available = input.available;
      if (input.stock !== undefined) {
        const stock = Number(input.stock);
        if (!Number.isInteger(stock) || stock < 0) throw businessError('สต็อกไม่ถูกต้อง', 400);
        item.stock = stock;
      }
      if (input.price !== undefined) {
        const price = Number(input.price);
        if (!Number.isFinite(price) || price <= 0) throw businessError('ราคาไม่ถูกต้อง', 400);
        item.price = Math.round(price * 100) / 100;
      }
      addAudit(state, 'MENU_UPDATED', item.id, item.name);
      return item;
    });
  }

  async reset() {
    this.state = makeSeed();
    await this.persist();
    return this.snapshot();
  }
}

function findOrder(state, id) {
  const order = state.orders.find((entry) => entry.id === id);
  if (!order) throw businessError('ไม่พบออเดอร์', 404);
  return order;
}

function nextOrderNo(orders) {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const daily = orders.filter((order) => order.orderNo?.startsWith(`SB-${date}`)).length + 1;
  return `SB-${date}-${String(daily).padStart(3, '0')}`;
}

function addAudit(state, action, entityId, detail) {
  state.audit.unshift({ id: randomUUID(), action, entityId, detail, createdAt: new Date().toISOString() });
  state.audit = state.audit.slice(0, 200);
}

export function businessError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

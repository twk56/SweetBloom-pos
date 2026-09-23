import test from 'node:test';
import assert from 'node:assert/strict';
import { CakeStore, makeSeed } from '../src/store.mjs';

function createStore() {
  return new CakeStore('memory.json', { memory: true, seed: makeSeed() });
}

function orderInput(overrides = {}) {
  return {
    customerName: 'มิน',
    phone: '0812345678',
    orderType: 'PICKUP',
    fulfillmentAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    idempotencyKey: `key-${Math.random()}`,
    items: [{ menuItemId: 'cake-strawberry', quantity: 1 }],
    ...overrides
  };
}

test('สร้างออเดอร์ ตัดสต็อก และคืนออเดอร์เดิมเมื่อ idempotency key ซ้ำ', async () => {
  const store = createStore();
  await store.init();
  const input = orderInput({ idempotencyKey: 'same-key', items: [{ menuItemId: 'cake-strawberry', quantity: 2 }] });
  const first = await store.createOrder(input);
  const second = await store.createOrder(input);
  assert.equal(first.id, second.id);
  assert.equal(store.snapshot().orders.length, 1);
  assert.equal(store.snapshot().menu.find((item) => item.id === 'cake-strawberry').stock, 6);
  assert.equal(first.total, 1476.6);
});

test('ห้ามข้ามสถานะและห้ามปิดออเดอร์ก่อนชำระ', async () => {
  const store = createStore();
  await store.init();
  const order = await store.createOrder(orderInput({ customerName: 'ออม', idempotencyKey: 'order-2', items: [{ menuItemId: 'cake-lemon', quantity: 1 }] }));
  await assert.rejects(() => store.updateOrderStatus(order.id, 'READY'), /ทีละขั้น/);
  await store.updateOrderStatus(order.id, 'CONFIRMED');
  await store.updateOrderStatus(order.id, 'BAKING');
  await store.updateOrderStatus(order.id, 'READY');
  await assert.rejects(() => store.updateOrderStatus(order.id, 'COMPLETED'), /ชำระ/);
});

test('รับชำระได้ครั้งเดียวและปิดออเดอร์ได้หลังชำระ', async () => {
  const store = createStore();
  await store.init();
  const order = await store.createOrder(orderInput({ customerName: 'พลอย', idempotencyKey: 'order-3', items: [{ menuItemId: 'cake-matcha', quantity: 2 }] }));
  await store.updateOrderStatus(order.id, 'CONFIRMED');
  await store.updateOrderStatus(order.id, 'BAKING');
  await store.updateOrderStatus(order.id, 'READY');
  const payment = await store.payOrder(order.id, { amount: order.total, method: 'QR', idempotencyKey: 'pay-3' });
  assert.equal(payment.amount, order.total);
  await assert.rejects(() => store.payOrder(order.id, { amount: order.total, method: 'QR', idempotencyKey: 'pay-other' }), /ชำระแล้ว/);
  const complete = await store.updateOrderStatus(order.id, 'COMPLETED');
  assert.equal(complete.status, 'COMPLETED');
});

test('ปฏิเสธออเดอร์เมื่อสต็อกไม่พอ', async () => {
  const store = createStore();
  await store.init();
  await assert.rejects(() => store.createOrder(orderInput({ customerName: 'ฟ้า', idempotencyKey: 'order-4', items: [{ menuItemId: 'cake-strawberry', quantity: 20 }] })), /เหลือเพียง/);
});

test('จัดส่งคิดค่าจัดส่งและยกเลิกก่อนทำแล้วคืนสต็อก', async () => {
  const store = createStore();
  await store.init();
  const order = await store.createOrder(orderInput({ orderType: 'DELIVERY', address: '99 ถนนสุขุมวิท กรุงเทพมหานคร 10110', idempotencyKey: 'delivery-1' }));
  assert.equal(order.deliveryFee, 60);
  assert.equal(order.total, 798.3);
  await store.cancelOrder(order.id, order.trackingToken);
  assert.equal(store.snapshot().menu.find((item) => item.id === 'cake-strawberry').stock, 8);
  assert.equal(store.snapshot().orders[0].status, 'CANCELLED');
});

test('ปฏิเสธเบอร์โทร ที่อยู่ และเวลานัดรับที่ไม่ถูกต้องโดยไม่ตัดสต็อก', async () => {
  const store = createStore();
  await store.init();
  await assert.rejects(() => store.createOrder(orderInput({ phone: '123' })), /เบอร์โทร/);
  await assert.rejects(() => store.createOrder(orderInput({ orderType: 'DELIVERY', address: 'สั้น' })), /ที่อยู่/);
  await assert.rejects(() => store.createOrder(orderInput({ fulfillmentAt: new Date().toISOString() })), /เวลารับสินค้า/);
  assert.equal(store.snapshot().menu.find((item) => item.id === 'cake-strawberry').stock, 8);
});

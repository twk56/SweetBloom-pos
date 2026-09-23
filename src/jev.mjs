const JEV_ENDPOINT = 'https://jev-ai.pro/api/v1/systemone';

export async function askJev({ state, questions, model = 'jev-latest', apiKey = process.env.JEV_AI_API_KEY, fetchImpl = fetch, timeoutMs = 20_000 }) {
  if (!apiKey) throw Object.assign(new Error('ยังไม่ได้ตั้งค่า JEV_AI_API_KEY'), { status: 503 });
  if (!questions || typeof questions !== 'object' || Array.isArray(questions)) throw Object.assign(new Error('คำถามสำหรับ Jev ไม่ถูกต้อง'), { status: 400 });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(JEV_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ state, model, questions }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload.error?.message || payload.error || `Jev API ตอบกลับ ${response.status}`;
      throw Object.assign(new Error(String(message)), { status: response.status === 401 ? 503 : response.status });
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw Object.assign(new Error('Jev API ใช้เวลานานเกินกำหนด'), { status: 504 });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function reviewOrderWithJev(order, options = {}) {
  const state = {
    order_type: order.orderType,
    total_baht: order.total,
    item_count: order.items.reduce((sum, item) => sum + item.quantity, 0),
    unique_products: order.items.length,
    minutes_until_fulfillment: Math.round((new Date(order.fulfillmentAt).getTime() - Date.now()) / 60_000),
    products: order.items.map((item) => ({ name: item.name, quantity: item.quantity }))
  };
  const result = await askJev({
    state,
    questions: {
      handling_priority: {
        type: 'choice',
        instructions: 'Choose the production handling priority for this bakery order. Use manual_review for unusual or operationally risky orders.',
        criteria: {
          normal: 'Enough lead time and ordinary production load',
          rush: 'Short lead time or large quantity requiring immediate attention',
          manual_review: 'Unusual combination or operational risk that a staff member should review'
        }
      },
      production_complexity: {
        type: 'score',
        instructions: 'Rate production complexity using item count, product variety, delivery and lead time.',
        criteria: ['Simple', 'Moderate', 'Complex']
      }
    },
    ...options
  });
  const priority = result.answers?.handling_priority || {};
  const complexity = result.answers?.production_complexity || {};
  return {
    model: result.model,
    priority: priority.choice || 'manual_review',
    confidence: Number(priority.confidence || 0),
    probabilities: priority.probabilities || {},
    complexity: Number(complexity.score || 0),
    reviewedAt: new Date().toISOString()
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createApp } from '../src/app.mjs';
import { deriveResultState } from '../public/app.mjs';

async function withServer(fn, options = {}) {
  const app = createApp({ processingDelayMs: 5, ...options });
  const server = createServer((req, res) => {
    app(req, res).catch((error) => { res.writeHead(500); res.end(error.message); });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
const input = { checkoutId: 'checkout-test-001', productId: 'DEMO-HEADSET', quantity: 1 };
const post = (base, key, body = input) => {
  const headers = { 'content-type': 'application/json' };
  if (key !== undefined) headers['Idempotency-Key'] = key;
  return fetch(`${base}/api/orders`, {
    method: 'POST', headers,
    body: JSON.stringify(body),
  });
};

test('a valid single order is created with the expected amount', () => withServer(async (base) => {
  const response = await post(base, 'order-key-0001');
  assert.equal(response.status, 201);
  const { order, replayed } = await response.json();
  assert.equal(order.amount, 129000);
  assert.equal(order.productName, '데모 헤드폰');
  assert.equal(replayed, false);
}));

test('two distinct orders are both accepted', () => withServer(async (base) => {
  assert.equal((await post(base, 'order-key-0001')).status, 201);
  assert.equal((await post(base, 'order-key-0002')).status, 201);
  const result = await (await fetch(`${base}/api/orders?checkoutId=${input.checkoutId}`)).json();
  assert.equal(result.total, 2);
}));

test('invalid quantities are rejected', () => withServer(async (base) => {
  assert.equal((await post(base, 'order-key-0001', { ...input, quantity: 0 })).status, 400);
}));

test('missing and malformed idempotency keys are rejected', () => withServer(async (base) => {
  for (const key of [undefined, 'short', 'invalid key', 'x'.repeat(81)]) {
    const response = await post(base, key);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_IDEMPOTENCY_KEY');
  }
  const result = await (await fetch(`${base}/api/orders?checkoutId=${input.checkoutId}`)).json();
  assert.equal(result.total, 0);
}));

test('a sequential retry reuses the completed order', () => withServer(async (base) => {
  const first = await post(base, 'retry-key-0001');
  const firstBody = await first.json();
  const second = await post(base, 'retry-key-0001');
  const secondBody = await second.json();

  assert.equal(first.status, 201);
  assert.equal(firstBody.replayed, false);
  assert.equal(second.status, 200);
  assert.equal(secondBody.replayed, true);
  assert.equal(secondBody.order.id, firstBody.order.id);

  const result = await (await fetch(`${base}/api/orders?checkoutId=${input.checkoutId}`)).json();
  assert.equal(result.total, 1);
}));

test('concurrent retries wait for and reuse one order', () => withServer(async (base) => {
  const responses = await Promise.all([
    post(base, 'concurrent-key-0001'),
    post(base, 'concurrent-key-0001'),
  ]);
  const bodies = await Promise.all(responses.map((response) => response.json()));

  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
  assert.deepEqual(bodies.map((body) => body.replayed).sort(), [false, true]);
  assert.equal(bodies[0].order.id, bodies[1].order.id);

  const result = await (await fetch(`${base}/api/orders?checkoutId=${input.checkoutId}`)).json();
  assert.equal(result.total, 1);
}));

test('reusing a completed key for different order content is rejected', () => withServer(async (base) => {
  const accepted = await post(base, 'conflict-key-0001');
  const acceptedBody = await accepted.json();
  const conflict = await post(base, 'conflict-key-0001', { ...input, quantity: 2 });

  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, 'IDEMPOTENCY_CONFLICT');
  const result = await (await fetch(`${base}/api/orders?checkoutId=${input.checkoutId}`)).json();
  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, acceptedBody.order.id);
  assert.equal(result.items[0].quantity, 1);
}));

test('reusing an in-progress key for different order content is rejected', () => withServer(async (base) => {
  const pending = post(base, 'pending-key-0001');
  await new Promise((resolve) => setTimeout(resolve, 20));
  const conflict = await post(base, 'pending-key-0001', { ...input, productId: 'DEMO-SPEAKER' });
  const accepted = await pending;

  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(accepted.status, 201);
  const result = await (await fetch(`${base}/api/orders?checkoutId=${input.checkoutId}`)).json();
  assert.equal(result.total, 1);
  assert.equal(result.items[0].productId, input.productId);
}, { processingDelayMs: 100 }));

test('an invalid order does not consume its idempotency key', () => withServer(async (base) => {
  const invalid = await post(base, 'reusable-key-0001', { ...input, quantity: 0 });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'INVALID_ORDER');

  const corrected = await post(base, 'reusable-key-0001');
  assert.equal(corrected.status, 201);
  assert.equal((await corrected.json()).replayed, false);
}));

test('the same key is independent across checkouts', () => withServer(async (base) => {
  const otherInput = { ...input, checkoutId: 'checkout-test-002' };
  const first = await post(base, 'scoped-key-0001');
  const second = await post(base, 'scoped-key-0001', otherInput);

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const firstResult = await (await fetch(`${base}/api/orders?checkoutId=${input.checkoutId}`)).json();
  const secondResult = await (await fetch(`${base}/api/orders?checkoutId=${otherInput.checkoutId}`)).json();
  assert.equal(firstResult.total, 1);
  assert.equal(secondResult.total, 1);
  assert.notEqual(firstResult.items[0].id, secondResult.items[0].id);
}));

test('health check remains available', () => withServer(async (base) => {
  const response = await fetch(`${base}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
}));

test('unknown routes return 404', () => withServer(async (base) => {
  assert.equal((await fetch(`${base}/missing`)).status, 404);
}));

test('order lists are scoped to the checkout', () => withServer(async (base) => {
  await post(base, 'order-key-0001');
  const result = await (await fetch(`${base}/api/orders?checkoutId=another-checkout`)).json();
  assert.equal(result.total, 0);
}));

test('a failed request cannot be presented as a successful matching result', () => {
  const result = deriveResultState({
    expectedOrders: 1,
    total: 0,
    successfulRequests: 0,
    failedRequests: 1,
  });

  assert.equal(result.state, 'error');
  assert.equal(result.title, '주문 요청에 실패했습니다');
  assert.match(result.detail, /실패 1회/);
});

test('mixed request outcomes are presented as partial even when the order count matches', () => {
  const result = deriveResultState({
    expectedOrders: 1,
    total: 1,
    successfulRequests: 1,
    failedRequests: 1,
  });

  assert.equal(result.state, 'partial');
  assert.equal(result.title, '일부 요청이 실패했습니다');
  assert.match(result.detail, /의도한 주문 1건 \/ 실제 생성 1건/);
});

test('a list failure cannot overwrite a successful response with an ok result', () => {
  const result = deriveResultState({
    expectedOrders: 1,
    successfulRequests: 1,
    failedRequests: 0,
    listFailed: true,
  });

  assert.equal(result.state, 'partial');
  assert.equal(result.title, '주문 응답은 받았지만 목록 조회에 실패했습니다');
});

test('only complete matching outcomes are presented as successful', () => {
  assert.equal(deriveResultState({
    expectedOrders: 1,
    total: 1,
    successfulRequests: 2,
    failedRequests: 0,
  }).state, 'ok');

  assert.equal(deriveResultState({
    expectedOrders: 2,
    total: 1,
    successfulRequests: 1,
    failedRequests: 0,
  }).state, 'partial');
});

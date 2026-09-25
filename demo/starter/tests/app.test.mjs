import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createApp } from '../src/app.mjs';

async function withServer(fn) {
  const app = createApp({ processingDelayMs: 5 });
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
const post = (base, key, body = input) => fetch(`${base}/api/orders`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
  body: JSON.stringify(body),
});

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

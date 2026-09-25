import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

assert.ok(process.env.DEMO_APP_PATH, 'DEMO_APP_PATH must identify the app under test');
const { createApp } = await import(pathToFileURL(process.env.DEMO_APP_PATH));
const order = { checkoutId: 'checkout-demo-001', productId: 'DEMO-HEADSET', quantity: 1 };
async function withServer(fn) {
  const app = createApp({ processingDelayMs: 25 });
  const server = createServer((req, res) => {
    app(req, res).catch((error) => { res.writeHead(500); res.end(error.message); });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (key, body = order) => fetch(`${base}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key === undefined ? {} : { 'Idempotency-Key': key }) },
    body: JSON.stringify(body),
  });
  const list = async (checkoutId = order.checkoutId) => (await fetch(`${base}/api/orders?checkoutId=${checkoutId}`)).json();
  try { await fn({ post, list, base }); }
  finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('AC2: sequential retries reuse the same order', () => withServer(async ({ post, list }) => {
  const first = await post('same-order-key');
  assert.equal(first.status, 201);
  const created = await first.json();
  const second = await post('same-order-key');
  assert.equal(second.status, 200);
  const replay = await second.json();
  assert.equal(replay.order.id, created.order.id);
  assert.equal(created.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal((await list()).total, 1);
}));

test('AC2: five simultaneous retries create exactly one order', () => withServer(async ({ post, list }) => {
  const responses = await Promise.all(Array.from({ length: 5 }, () => post('same-order-key')));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 200, 200, 200, 201]);
  const bodies = await Promise.all(responses.map((response) => response.json()));
  assert.equal(new Set(bodies.map((body) => body.order.id)).size, 1);
  assert.equal(bodies.filter((body) => body.replayed === false).length, 1);
  assert.equal((await list()).total, 1);
}));

for (const changes of [{ quantity: 2 }, { productId: 'DEMO-SPEAKER' }]) {
  test(`AC3: same key with different ${Object.keys(changes)[0]} is rejected`, () => withServer(async ({ post, list }) => {
    const first = await (await post('same-order-key')).json();
    const conflicting = await post('same-order-key', { ...order, ...changes });
    assert.equal(conflicting.status, 409);
    assert.equal((await conflicting.json()).error.code, 'IDEMPOTENCY_CONFLICT');
    const items = await list();
    assert.equal(items.total, 1);
    assert.deepEqual(items.items[0], first.order);
  }));
}

test('AC3: conflicting concurrent payloads cannot overwrite an in-flight request', () => withServer(async ({ post, list }) => {
  const responses = await Promise.all([post('same-order-key'), post('same-order-key', { ...order, quantity: 2 })]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal((await list()).total, 1);
  const created = await responses.find((response) => response.status === 201).json();
  const validBody = { ...order, quantity: created.order.quantity };
  const replay = await post('same-order-key', validBody);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).order.id, created.order.id);
}));

test('AC4: a separate new order remains possible', () => withServer(async ({ post, list }) => {
  const first = await (await post('new-order-key-1')).json();
  const second = await (await post('new-order-key-2')).json();
  assert.notEqual(first.order.id, second.order.id);
  assert.equal((await list()).total, 2);
}));

test('AC4: identical keys in different checkout scopes are independent', () => withServer(async ({ post, list }) => {
  assert.equal((await post('same-order-key')).status, 201);
  assert.equal((await post('same-order-key', { ...order, checkoutId: 'different-checkout' })).status, 201);
  assert.equal((await list()).total, 1);
  assert.equal((await list('different-checkout')).total, 1);
}));

for (const [name, key] of [['missing', undefined], ['short', 'short'], ['invalid characters', 'bad key value'], ['too long', 'x'.repeat(81)]]) {
  test(`AC1: ${name} key is rejected before creating an order`, () => withServer(async ({ post, list }) => {
    const response = await post(key);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_IDEMPOTENCY_KEY');
    assert.equal((await list()).total, 0);
  }));
}

test('AC1: valid 8- and 80-character keys are accepted', () => withServer(async ({ post, list }) => {
  assert.equal((await post('A_0-abCD')).status, 201);
  assert.equal((await post('a'.repeat(80))).status, 201);
  assert.equal((await list()).total, 2);
}));

for (const invalid of [{ quantity: 0 }, { quantity: 1.5 }, { productId: 'UNKNOWN' }]) {
  test(`AC5: invalid order ${JSON.stringify(invalid)} does not consume a key`, () => withServer(async ({ post, list }) => {
    const response = await post('retry-after-fix', { ...order, ...invalid });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_ORDER');
    assert.equal((await post('retry-after-fix')).status, 201);
    assert.equal((await list()).total, 1);
  }));
}

test('AC5: health check and unknown-route behavior remain unchanged', () => withServer(async ({ base }) => {
  const response = await fetch(`${base}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  assert.equal((await fetch(`${base}/missing`)).status, 404);
}));

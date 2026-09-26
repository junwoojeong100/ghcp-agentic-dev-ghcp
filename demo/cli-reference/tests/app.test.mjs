import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
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
const postWithoutKey = (base, body = input) => fetch(`${base}/api/orders`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

async function createBrowserHarness(fetchImpl) {
  class Element {
    constructor() {
      this.children = [];
      this.dataset = {};
      this.disabled = false;
      this.listeners = new Map();
      this.text = '';
    }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return this.text + this.children.map((child) => child.textContent).join(''); }
    replaceChildren(...children) { this.children = children; this.text = ''; }
    append(...children) { this.children.push(...children); }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    click() { return this.listeners.get('click')?.(); }
  }

  const selectors = [
    '#request-count', '#order-count', '#trace', '#result-banner', '#result-title',
    '#result-detail', '#orders', '#feedback', '#send-once', '#send-twice', '#new-order',
  ];
  const elements = new Map(selectors.map((selector) => [selector, new Element()]));
  const document = {
    querySelector: (selector) => elements.get(selector),
    querySelectorAll: (selector) => selector === 'button'
      ? ['#send-once', '#send-twice', '#new-order'].map((key) => elements.get(key))
      : [],
    createElement: () => new Element(),
    createTextNode: (text) => ({ textContent: String(text) }),
  };
  let id = 0;
  const source = await readFile(new URL('../public/app.mjs', import.meta.url), 'utf8');
  runInNewContext(source, {
    document,
    crypto: { randomUUID: () => `browser-test-${++id}` },
    fetch: fetchImpl,
  });
  return elements;
}

const browserResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const browserOrder = { id: 'ORD-0001', productName: '데모 헤드폰', amount: 129000 };

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

test('sequential retries reuse the original order', () => withServer(async (base) => {
  const first = await post(base, 'order-key-0001');
  const replay = await post(base, 'order-key-0001');
  const firstBody = await first.json();
  const replayBody = await replay.json();
  assert.equal(first.status, 201);
  assert.equal(firstBody.replayed, false);
  assert.equal(replay.status, 200);
  assert.equal(replayBody.replayed, true);
  assert.equal(replayBody.order.id, firstBody.order.id);
  const result = await (await fetch(`${base}/api/orders?checkoutId=${input.checkoutId}`)).json();
  assert.equal(result.total, 1);
}));

test('simultaneous identical requests create one order and share its result', () => withServer(async (base) => {
  const responses = await Promise.all([
    post(base, 'order-key-0001'),
    post(base, 'order-key-0001'),
  ]);
  const bodies = await Promise.all(responses.map((response) => response.json()));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
  assert.deepEqual(bodies.map((body) => body.replayed).sort(), [false, true]);
  assert.equal(bodies[0].order.id, bodies[1].order.id);
  const result = await (await fetch(`${base}/api/orders?checkoutId=${input.checkoutId}`)).json();
  assert.equal(result.total, 1);
}));

test('reusing a key with a different product or quantity conflicts without changing the original', () => withServer(async (base) => {
  const first = await post(base, 'order-key-0001');
  const quantityConflict = await post(base, 'order-key-0001', { ...input, quantity: 2 });
  const productConflict = await post(base, 'order-key-0001', { ...input, productId: 'DEMO-SPEAKER' });
  for (const conflict of [quantityConflict, productConflict]) {
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error.code, 'IDEMPOTENCY_CONFLICT');
  }
  const replay = await post(base, 'order-key-0001');
  const firstBody = await first.json();
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).order.id, firstBody.order.id);
  const result = await (await fetch(`${base}/api/orders?checkoutId=${input.checkoutId}`)).json();
  assert.equal(result.total, 1);
}));

test('an in-flight request reserves its key against conflicting content', () => withServer(async (base) => {
  const firstPending = post(base, 'order-key-0001');
  const conflict = await post(base, 'order-key-0001', { ...input, quantity: 2 });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, 'IDEMPOTENCY_CONFLICT');
  const first = await firstPending;
  assert.equal(first.status, 201);
  const result = await (await fetch(`${base}/api/orders?checkoutId=${input.checkoutId}`)).json();
  assert.equal(result.total, 1);
}));

test('the same key is independent across checkouts', () => withServer(async (base) => {
  const otherCheckout = { ...input, checkoutId: 'checkout-test-002' };
  const first = await post(base, 'order-key-0001');
  const second = await post(base, 'order-key-0001', otherCheckout);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual((await first.json()).order.id, (await second.json()).order.id);
}));

test('invalid orders do not consume an idempotency key', () => withServer(async (base) => {
  const invalid = await post(base, 'order-key-0001', { ...input, quantity: 0 });
  const corrected = await post(base, 'order-key-0001');
  const replay = await post(base, 'order-key-0001');
  assert.equal(invalid.status, 400);
  assert.equal(corrected.status, 201);
  assert.equal((await corrected.json()).replayed, false);
  assert.equal(replay.status, 200);
}));

test('missing and malformed idempotency keys are rejected', () => withServer(async (base) => {
  const responses = await Promise.all([
    postWithoutKey(base),
    post(base, 'short'),
    post(base, 'invalid!key'),
    post(base, 'x'.repeat(81)),
  ]);
  for (const response of responses) {
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_IDEMPOTENCY_KEY');
  }
  const result = await (await fetch(`${base}/api/orders?checkoutId=${input.checkoutId}`)).json();
  assert.equal(result.total, 0);
}));

test('8- and 80-character idempotency keys are valid', () => withServer(async (base) => {
  const short = await post(base, '12345678');
  const long = await post(base, 'x'.repeat(80), { ...input, checkoutId: 'checkout-test-002' });
  assert.equal(short.status, 201);
  assert.equal(long.status, 201);
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

test('request failures show their error code and a successful retry restores the ok state', async () => {
  let posts = 0;
  const elements = await createBrowserHarness(async (url) => {
    if (url === '/api/orders') {
      posts += 1;
      return posts === 1
        ? browserResponse(503, { error: { code: 'SIMULATED_OUTAGE' } })
        : browserResponse(200, { order: browserOrder, replayed: true });
    }
    return browserResponse(200, posts === 1 ? { items: [], total: 0 } : { items: [browserOrder], total: 1 });
  });

  await elements.get('#send-once').click();
  assert.equal(elements.get('#result-banner').dataset.state, 'error');
  assert.match(elements.get('#feedback').textContent, /SIMULATED_OUTAGE/);
  assert.equal(elements.get('#feedback').dataset.error, 'true');
  assert.equal(elements.get('#send-once').disabled, false);

  await elements.get('#send-once').click();
  assert.equal(elements.get('#result-banner').dataset.state, 'ok');
  assert.equal(elements.get('#result-title').textContent, '의도한 주문 수와 일치합니다');
  assert.equal(elements.get('#feedback').dataset.error, undefined);
  assert.match(elements.get('#feedback').textContent, /기존 결과 재사용 1건/);
});

test('partial request failure cannot report ok even when the intended order exists', async () => {
  let posts = 0;
  const elements = await createBrowserHarness(async (url) => {
    if (url === '/api/orders') {
      posts += 1;
      return posts === 1
        ? browserResponse(201, { order: browserOrder, replayed: false })
        : browserResponse(503, { error: { code: 'SIMULATED_OUTAGE' } });
    }
    return browserResponse(200, { items: [browserOrder], total: 1 });
  });

  await elements.get('#send-twice').click();
  assert.equal(elements.get('#result-banner').dataset.state, 'error');
  assert.equal(elements.get('#result-title').textContent, '일부 요청이 실패했습니다');
  assert.match(elements.get('#feedback').textContent, /성공 1개 · 실패 1개/);
  assert.match(elements.get('#feedback').textContent, /SIMULATED_OUTAGE/);
});

test('order-list failures and count mismatches never report ok', async () => {
  let listRequests = 0;
  const elements = await createBrowserHarness(async (url) => {
    if (url === '/api/orders') return browserResponse(201, { order: browserOrder, replayed: false });
    listRequests += 1;
    if (listRequests === 1) return browserResponse(503, { error: { code: 'SIMULATED_LIST_OUTAGE' } });
    return browserResponse(200, { items: [], total: 0 });
  });

  await elements.get('#send-once').click();
  assert.notEqual(elements.get('#result-banner').dataset.state, 'ok');
  assert.match(elements.get('#feedback').textContent, /SIMULATED_LIST_OUTAGE/);
  assert.equal(elements.get('#feedback').dataset.error, 'true');

  await elements.get('#send-once').click();
  assert.notEqual(elements.get('#result-banner').dataset.state, 'ok');
  assert.match(elements.get('#result-detail').textContent, /의도한 주문 1건 \/ 실제 생성 0건/);
  assert.match(elements.get('#feedback').textContent, /주문 수가 일치하지 않습니다/);
});

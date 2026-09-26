import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { products } from './data.mjs';

const publicRoot = new URL('../public/', import.meta.url);
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(value);

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function readOrder(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 4096) throw new Error('request body is too large');
    chunks.push(chunk);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!body || typeof body !== 'object' || !validId(body.checkoutId)) throw new Error('invalid checkoutId');
  if (!Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 10) throw new Error('quantity must be an integer from 1 to 10');
  if (!products.some((product) => product.id === body.productId)) throw new Error('unknown productId');
  return { checkoutId: body.checkoutId, productId: body.productId, quantity: body.quantity };
}

export function createApp({ processingDelayMs = 350 } = {}) {
  const orders = [];
  const idempotency = new Map();
  let sequence = 0;

  async function createOrder(input) {
    await delay(processingDelayMs);
    const product = products.find((item) => item.id === input.productId);
    const order = {
      id: `ORD-${String(++sequence).padStart(4, '0')}`,
      checkoutId: input.checkoutId, productId: product.id, productName: product.name,
      quantity: input.quantity, amount: product.price * input.quantity, status: 'received',
    };
    orders.push(order);
    return order;
  }

  return async function handleRequest(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/healthz') {
      json(res, 200, { status: 'ok' }); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/orders') {
      const checkoutId = url.searchParams.get('checkoutId');
      if (!validId(checkoutId)) { json(res, 400, { error: { code: 'INVALID_CHECKOUT' } }); return; }
      const items = orders.filter((order) => order.checkoutId === checkoutId);
      json(res, 200, { items, total: items.length }); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/orders') {
      const key = req.headers['idempotency-key'];
      if (!validId(key)) {
        json(res, 400, { error: { code: 'INVALID_IDEMPOTENCY_KEY' } }); return;
      }
      let input;
      try {
        input = await readOrder(req);
      } catch (error) {
        json(res, 400, { error: { code: 'INVALID_ORDER', message: error.message } }); return;
      }
      const scope = JSON.stringify([input.checkoutId, key]);
      const existing = idempotency.get(scope);
      if (existing) {
        if (existing.productId !== input.productId || existing.quantity !== input.quantity) {
          json(res, 409, { error: { code: 'IDEMPOTENCY_CONFLICT' } }); return;
        }
        const order = await existing.promise;
        json(res, 200, { order, replayed: true }); return;
      }
      const entry = { productId: input.productId, quantity: input.quantity, promise: null };
      idempotency.set(scope, entry);
      entry.promise = createOrder(input).catch((error) => {
        if (idempotency.get(scope) === entry) idempotency.delete(scope);
        throw error;
      });
      const order = await entry.promise;
      json(res, 201, { order, replayed: false }); return;
    }
    if (req.method === 'GET' && staticFiles.has(url.pathname)) {
      const [file, type] = staticFiles.get(url.pathname);
      const content = await readFile(new URL(file, publicRoot));
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(content); return;
    }
    json(res, 404, { error: { code: 'NOT_FOUND' } });
  };
}

export const handleRequest = createApp();

const $ = (selector) => document.querySelector(selector);
const checkoutId = crypto.randomUUID();
let requestKey = crypto.randomUUID();
let requestCount = 0;
let expectedOrders = 1;
const results = [];
const money = (value) => `${value.toLocaleString('ko-KR')}원`;

function setCount(selector, count, suffix) {
  $(selector).replaceChildren(document.createTextNode(String(count)));
  const small = document.createElement('small');
  small.textContent = suffix;
  $(selector).append(small);
}

async function send(key) {
  requestCount += 1;
  setCount('#request-count', requestCount, '회');
  const response = await fetch('/api/orders', {
    method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ checkoutId, productId: 'DEMO-HEADSET', quantity: 1 }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`주문 처리 실패: ${body.error?.code ?? response.status}`);
  results.push({ status: response.status, ...body });
}

async function render() {
  const response = await fetch(`/api/orders?checkoutId=${encodeURIComponent(checkoutId)}`);
  if (!response.ok) throw new Error(`주문 목록 조회 실패: HTTP ${response.status}`);
  const { items, total } = await response.json();
  setCount('#order-count', total, '건');
  $('#orders').replaceChildren();
  for (const order of items) {
    const row = document.createElement('div');
    row.className = 'order-row';
    const id = document.createElement('strong');
    id.textContent = order.id;
    const name = document.createElement('span');
    name.textContent = order.productName;
    const amount = document.createElement('span');
    amount.textContent = money(order.amount);
    row.append(id, name, amount);
    $('#orders').append(row);
  }
  $('#trace').replaceChildren();
  for (const [index, result] of results.entries()) {
    const line = document.createElement('div');
    line.className = 'trace-row';
    line.textContent = `응답 ${index + 1} · ${result.status} · ${result.order.id} · 새 주문 생성`;
    $('#trace').append(line);
  }
  const duplicate = total > expectedOrders;
  $('#result-banner').dataset.state = duplicate ? 'duplicate' : 'ok';
  $('#result-title').textContent = duplicate ? '같은 주문이 중복 생성되었습니다' : '의도한 주문 수와 일치합니다';
  $('#result-detail').textContent = `의도한 주문 ${expectedOrders}건 / 실제 생성 ${total}건`;
}

async function submit(count, newOrder = false) {
  if (newOrder) {
    requestKey = crypto.randomUUID();
    expectedOrders += 1;
  }
  $('#feedback').textContent = '서버 응답을 기다리는 중입니다…';
  delete $('#feedback').dataset.error;
  try {
    await Promise.all(Array.from({ length: count }, () => send(requestKey)));
    await render();
    $('#feedback').textContent = '처리 결과를 확인하세요. 실제 결제는 실행하지 않았습니다.';
  } catch (error) {
    $('#feedback').textContent = error.message;
    $('#feedback').dataset.error = 'true';
  }
}

$('#send-once').addEventListener('click', () => submit(1));
$('#send-twice').addEventListener('click', () => submit(2));
$('#new-order').addEventListener('click', () => submit(1, true));

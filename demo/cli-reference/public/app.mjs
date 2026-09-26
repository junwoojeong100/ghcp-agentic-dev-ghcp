const $ = (selector) => document.querySelector(selector);
const checkoutId = crypto.randomUUID();
let requestKey = crypto.randomUUID();
let requestCount = 0;
let expectedOrders = 0;
const expectedKeys = new Set();
const results = [];
let submitting = false;
const money = (value) => `${value.toLocaleString('ko-KR')}원`;

function setCount(selector, count, suffix) {
  $(selector).replaceChildren(document.createTextNode(String(count)));
  const small = document.createElement('small');
  small.textContent = suffix;
  $(selector).append(small);
}

function setBanner(state, title, detail) {
  $('#result-banner').dataset.state = state;
  $('#result-title').textContent = title;
  $('#result-detail').textContent = detail;
}

async function send(key) {
  requestCount += 1;
  setCount('#request-count', requestCount, '회');
  try {
    const response = await fetch('/api/orders', {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ checkoutId, productId: 'DEMO-HEADSET', quantity: 1 }),
    });
    const body = await response.json();
    if (!response.ok) {
      const code = body.error?.code ?? `HTTP ${response.status}`;
      const result = {
        ok: false,
        status: response.status,
        error: `${code}${body.error?.message ? `: ${body.error.message}` : ''}`,
      };
      results.push(result);
      return result;
    }
    const result = { ok: true, status: response.status, order: body.order, replayed: body.replayed === true };
    results.push(result);
    return result;
  } catch (error) {
    const result = { ok: false, status: null, error: `요청 실패: ${error.message}` };
    results.push(result);
    return result;
  }
}

async function render(outcomes) {
  $('#trace').replaceChildren();
  for (const [index, result] of results.entries()) {
    const line = document.createElement('div');
    line.className = 'trace-row';
    line.textContent = result.ok
      ? `응답 ${index + 1} · ${result.status} · ${result.order.id} · ${result.replayed ? '기존 주문 결과 재사용' : '새 주문 생성'}`
      : `응답 ${index + 1} · 실패${result.status ? ` · HTTP ${result.status}` : ''} · ${result.error}`;
    $('#trace').append(line);
  }
  let response;
  try {
    response = await fetch(`/api/orders?checkoutId=${encodeURIComponent(checkoutId)}`);
  } catch (error) {
    throw new Error(`주문 목록 조회 실패: ${error.message}`);
  }
  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new Error(`주문 목록 조회 실패: ${error.message}`);
  }
  if (!response.ok) {
    const code = body?.error?.code ?? `HTTP ${response.status}`;
    const message = body?.error?.message ? `: ${body.error.message}` : '';
    throw new Error(`주문 목록 조회 실패: ${code}${message}`);
  }
  const { items, total } = body ?? {};
  if (!Array.isArray(items) || !Number.isInteger(total) || total !== items.length) {
    throw new Error('주문 목록 조회 실패: 응답 형식이 올바르지 않습니다.');
  }
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
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '아직 주문이 없습니다.';
    $('#orders').append(empty);
  }
  const failures = outcomes.filter((result) => !result.ok).length;
  const detail = `의도한 주문 ${expectedOrders}건 / 실제 생성 ${total}건`;
  if (failures) {
    const successes = outcomes.length - failures;
    const title = successes ? '일부 요청이 실패했습니다' : '모든 요청이 실패했습니다';
    setBanner('error', title, `${detail} · 성공 ${successes}건 / 실패 ${failures}건`);
    return { state: 'error', total };
  }
  if (total > expectedOrders) {
    setBanner('duplicate', '의도한 주문보다 더 많이 생성되었습니다', detail);
    return { state: 'duplicate', total };
  }
  if (total !== expectedOrders) {
    setBanner('error', '의도한 주문 수와 다릅니다', detail);
    return { state: 'mismatch', total };
  }
  setBanner('ok', '의도한 주문 수와 일치합니다', detail);
  return { state: 'ok', total };
}

async function submit(count, newOrder = false) {
  if (submitting) return;
  submitting = true;
  for (const button of document.querySelectorAll('button')) button.disabled = true;
  if (newOrder) {
    requestKey = crypto.randomUUID();
  }
  if (!expectedKeys.has(requestKey)) {
    expectedKeys.add(requestKey);
    expectedOrders += 1;
  }
  $('#feedback').textContent = '서버 응답을 기다리는 중입니다…';
  delete $('#feedback').dataset.error;
  setBanner('loading', '요청 처리 중입니다', '응답과 주문 목록을 확인하고 있습니다.');
  try {
    const outcomes = await Promise.all(Array.from({ length: count }, () => send(requestKey)));
    const failedOutcomes = outcomes.filter((outcome) => !outcome.ok);
    let summary;
    let listError = null;
    try {
      summary = await render(outcomes);
    } catch (error) {
      listError = error;
      setBanner('error', '주문 목록을 확인하지 못했습니다', error.message);
    }
    const replays = outcomes.filter((outcome) => outcome.ok && outcome.replayed).length;
    const created = outcomes.filter((outcome) => outcome.ok && !outcome.replayed).length;
    if (failedOutcomes.length || listError) {
      const messages = [];
      if (failedOutcomes.length) {
        const successes = outcomes.length - failedOutcomes.length;
        messages.push(`${outcomes.length}개 요청 중 성공 ${successes}개 · 실패 ${failedOutcomes.length}개: ${failedOutcomes.map((outcome) => outcome.error).join(' · ')}. 각 응답과 현재 주문 목록을 확인하세요.`);
      }
      if (listError) messages.push(listError.message);
      $('#feedback').textContent = `${messages.join(' · ')} 실제 결제는 실행하지 않았습니다.`;
      $('#feedback').dataset.error = 'true';
    } else if (summary.state !== 'ok') {
      $('#feedback').textContent = `요청 응답은 성공했지만 주문 수가 일치하지 않습니다. 의도한 주문 ${expectedOrders}건 / 실제 생성 ${summary.total}건. 실제 결제는 실행하지 않았습니다.`;
      $('#feedback').dataset.error = 'true';
    } else {
      $('#feedback').textContent = `새 주문 ${created}건 · 기존 결과 재사용 ${replays}건. 실제 결제는 실행하지 않았습니다.`;
      delete $('#feedback').dataset.error;
    }
  } catch (error) {
    $('#feedback').textContent = error.message;
    $('#feedback').dataset.error = 'true';
    setBanner('error', '주문 요청을 처리하지 못했습니다', error.message);
  } finally {
    submitting = false;
    for (const button of document.querySelectorAll('button')) button.disabled = false;
  }
}

$('#send-once').addEventListener('click', () => submit(1));
$('#send-twice').addEventListener('click', () => submit(2));
$('#new-order').addEventListener('click', () => submit(1, true));

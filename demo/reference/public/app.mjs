export function deriveResultState({
  expectedOrders,
  total,
  successfulRequests,
  failedRequests,
  listFailed = false,
}) {
  const requestSummary = `성공 응답 ${successfulRequests}회 / 실패 ${failedRequests}회`;

  if (listFailed) {
    return {
      state: successfulRequests > 0 ? 'partial' : 'error',
      title: successfulRequests > 0
        ? '주문 응답은 받았지만 목록 조회에 실패했습니다'
        : '주문 처리 결과를 확인하지 못했습니다',
      detail: `${requestSummary} · 주문 목록 조회 실패`,
    };
  }
  if (failedRequests > 0) {
    return {
      state: successfulRequests > 0 ? 'partial' : 'error',
      title: successfulRequests > 0 ? '일부 요청이 실패했습니다' : '주문 요청에 실패했습니다',
      detail: `${requestSummary} · 의도한 주문 ${expectedOrders}건 / 실제 생성 ${total}건`,
    };
  }
  if (total > expectedOrders) {
    return {
      state: 'duplicate',
      title: '같은 주문이 중복 생성되었습니다',
      detail: `의도한 주문 ${expectedOrders}건 / 실제 생성 ${total}건`,
    };
  }
  if (total < expectedOrders) {
    return {
      state: 'partial',
      title: '의도한 주문이 모두 생성되지 않았습니다',
      detail: `의도한 주문 ${expectedOrders}건 / 실제 생성 ${total}건`,
    };
  }
  return {
    state: 'ok',
    title: '의도한 주문 수와 일치합니다',
    detail: `의도한 주문 ${expectedOrders}건 / 실제 생성 ${total}건`,
  };
}

function startApp() {
  const $ = (selector) => document.querySelector(selector);
  const checkoutId = crypto.randomUUID();
  let requestKey = crypto.randomUUID();
  let requestCount = 0;
  let expectedOrders = 0;
  let submitting = false;
  const submittedKeys = new Set();
  const results = [];
  const money = (value) => `${value.toLocaleString('ko-KR')}원`;
  const buttons = ['#send-once', '#send-twice', '#new-order'].map($);

  function setCount(selector, count, suffix) {
    $(selector).replaceChildren(document.createTextNode(String(count)));
    const small = document.createElement('small');
    small.textContent = suffix;
    $(selector).append(small);
  }

  async function send(key) {
    requestCount += 1;
    setCount('#request-count', requestCount, '회');
    let response;
    try {
      response = await fetch('/api/orders', {
        method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ checkoutId, productId: 'DEMO-HEADSET', quantity: 1 }),
      });
    } catch (error) {
      throw new Error(`주문 요청 실패: ${error.message}`);
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error(`주문 처리 실패: HTTP ${response.status} 응답을 읽을 수 없습니다.`);
    }
    if (!response.ok) throw new Error(`주문 처리 실패: ${body.error?.code ?? response.status}`);
    results.push({ status: response.status, ...body });
  }

  async function loadOrders() {
    let response;
    try {
      response = await fetch(`/api/orders?checkoutId=${encodeURIComponent(checkoutId)}`);
    } catch (error) {
      throw new Error(`주문 목록 조회 실패: ${error.message}`);
    }
    if (!response.ok) throw new Error(`주문 목록 조회 실패: HTTP ${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new Error('주문 목록 조회 실패: 응답을 읽을 수 없습니다.');
    }
  }

  function renderOrders({ items, total }) {
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
  }

  function renderTrace() {
    $('#trace').replaceChildren();
    for (const [index, result] of results.entries()) {
      const line = document.createElement('div');
      line.className = 'trace-row';
      const outcome = result.replayed ? '기존 주문 결과 재사용' : '새 주문 생성';
      line.textContent = `응답 ${index + 1} · ${result.status} · ${result.order.id} · ${outcome}`;
      $('#trace').append(line);
    }
  }

  function renderResult(state) {
    $('#result-banner').dataset.state = state.state;
    $('#result-title').textContent = state.title;
    $('#result-detail').textContent = state.detail;
  }

  async function submit(count, newOrder = false) {
    if (submitting) return;
    submitting = true;
    if (newOrder) {
      requestKey = crypto.randomUUID();
    }
    if (!submittedKeys.has(requestKey)) {
      submittedKeys.add(requestKey);
      expectedOrders += 1;
    }
    $('#order-controls').setAttribute('aria-busy', 'true');
    for (const button of buttons) button.disabled = true;
    $('#feedback').textContent = '서버 응답을 기다리는 중입니다…';
    delete $('#feedback').dataset.error;
    try {
      const outcomes = await Promise.allSettled(Array.from({ length: count }, () => send(requestKey)));
      const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
      const successfulRequests = outcomes.length - failures.length;
      let orderList;
      let listError;
      try {
        orderList = await loadOrders();
        renderOrders(orderList);
      } catch (error) {
        listError = error;
      }
      renderTrace();
      renderResult(deriveResultState({
        expectedOrders,
        total: orderList?.total,
        successfulRequests,
        failedRequests: failures.length,
        listFailed: Boolean(listError),
      }));

      if (failures.length > 0 || listError) {
        const messages = [
          ...new Set(failures.map((failure) => failure.reason.message)),
          listError?.message,
        ].filter(Boolean);
        $('#feedback').textContent = messages.join(' · ');
        $('#feedback').dataset.error = 'true';
      } else {
        $('#feedback').textContent = '처리 결과를 확인하세요. 실제 결제는 실행하지 않았습니다.';
      }
    } finally {
      submitting = false;
      $('#order-controls').setAttribute('aria-busy', 'false');
      for (const button of buttons) button.disabled = false;
    }
  }

  $('#send-once').addEventListener('click', () => submit(1));
  $('#send-twice').addEventListener('click', () => submit(2));
  $('#new-order').addEventListener('click', () => submit(1, true));
}

if (typeof document !== 'undefined') startApp();

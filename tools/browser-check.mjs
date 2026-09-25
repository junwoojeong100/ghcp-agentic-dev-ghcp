import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const assets = resolve(root, 'presentation/assets');
const evidence = resolve(root, 'evidence');
await mkdir(assets, { recursive: true });
await mkdir(evidence, { recursive: true });
const before = process.env.BEFORE_URL || 'http://127.0.0.1:4311';
const after = process.env.AFTER_URL || 'http://127.0.0.1:4310';
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, locale: 'ko-KR' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const report = { recordedAt: new Date().toISOString(), before, after, browser: browser.version(), checks: [], screenshots: [], realPayments: false };
const initialEvidence = await (await context.request.get(`${after}/__demo/evidence`)).json();
report.sourceDigest = initialEvidence.currentDigest;
report.savedReplay = initialEvidence.saved;
if (process.env.EXPECT_SAVED !== undefined) {
  assert.equal(initialEvidence.saved, process.env.EXPECT_SAVED === 'true');
}
async function check(name, fn) {
  try {
    const details = await fn();
    report.checks.push({ name, passed: true, ...(details ? { details } : {}) });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.checks.push({ name, passed: false, error: error.message });
    throw error;
  }
}
async function screenshot(name) {
  await page.screenshot({ path: resolve(assets, name), fullPage: true });
  report.screenshots.push(`presentation/assets/${name}`);
}
async function readyCount(count) {
  await expect(page.locator('#order-count')).toHaveText(`${count}건`);
  await expect(page.locator('#send-twice')).toBeEnabled();
}
try {
  await check('Before: two concurrent identical requests create two orders', async () => {
    await page.goto(before);
    await page.locator('#send-twice').click();
    await readyCount(2);
    await expect(page.locator('#result-banner')).toHaveAttribute('data-state', 'duplicate');
    await screenshot('01-before.png');
    return { requests: 2, orders: 2, traces: await page.locator('.trace-row').allTextContents() };
  });
  await check('After: two concurrent identical requests create one order and show replay', async () => {
    await page.goto(after);
    await page.locator('#send-twice').click();
    await readyCount(1);
    await expect(page.locator('#request-count')).toHaveText('2회');
    await expect(page.locator('#result-banner')).toHaveAttribute('data-state', 'ok');
    await expect(page.locator('#trace')).toContainText('기존');
    const traces = await page.locator('.trace-row').allTextContents();
    assert.equal(new Set(traces.map((text) => text.match(/ORD-\d+/)?.[0])).size, 1);
    await screenshot('02-after.png');
    return { requests: 2, orders: 1, traces };
  });
  await check('A legitimate separate new order still creates a second order', async () => {
    await page.locator('#new-order').click();
    await readyCount(2);
    await expect(page.locator('#request-count')).toHaveText('3회');
    await expect(page.locator('#result-banner')).toHaveAttribute('data-state', 'ok');
    await expect(page.locator('#result-detail')).toContainText('의도한 주문 2건');
    await screenshot('03-new-order.png');
    return { requests: 3, orders: 2 };
  });
  await check('Retrying the latest order does not add another order', async () => {
    await page.locator('#send-once').click();
    await expect(page.locator('#request-count')).toHaveText('4회');
    await readyCount(2);
    await expect(page.locator('.trace-row')).toHaveCount(4);
  });
  await check('Normal button suppresses overlapping duplicate clicks', async () => {
    await page.goto(after);
    await page.locator('#send-once').evaluate((button) => { button.click(); button.click(); });
    await readyCount(1);
    await expect(page.locator('#request-count')).toHaveText('1회');
  });
  await check('A separate new order can be the first action without false expected counts', async () => {
    await page.goto(after);
    await page.locator('#new-order').click();
    await readyCount(1);
    await expect(page.locator('#result-detail')).toContainText('의도한 주문 1건');
  });
  await check('Service errors are visible and controls recover', async () => {
    await page.goto(after);
    await page.route('**/api/orders', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SIMULATED_OUTAGE' } }) });
      } else {
        await route.continue();
      }
    });
    await page.locator('#send-once').click();
    await expect(page.locator('#feedback')).toHaveAttribute('data-error', 'true');
    await expect(page.locator('#feedback')).toContainText('SIMULATED_OUTAGE');
    await expect(page.locator('#result-banner')).not.toHaveAttribute('data-state', 'ok');
    await expect(page.locator('#send-once')).toBeEnabled();
    await page.unroute('**/api/orders');
    await page.locator('#send-once').click();
    await readyCount(1);
  });
  await check('Evidence desk distinguishes records from final human approval', async () => {
    await page.goto(`${after}/presenter?tab=review`);
    await expect(page.locator('#artifact')).toContainText('RECOMMENDATION:');
    await expect(page.locator('#approval')).toHaveText('최종 출시 판단 대기');
    await expect(page.locator('#mode')).toContainText(initialEvidence.saved ? 'SAVED REHEARSAL' : 'LIVE WORKSPACE');
    await screenshot('04-review.png');
    await page.getByRole('button', { name: '04 재발 방지', exact: true }).click();
    await expect(page.locator('#artifact')).toContainText('# fail 0');
    await screenshot('05-verification.png');
    if (initialEvidence.artifacts['first-review.md']) {
      await page.getByRole('button', { name: '재작업 기록', exact: true }).click();
      await expect(page.locator('#artifact')).toContainText('RECOMMENDATION:');
      await screenshot('07-rework.png');
    }
    await page.getByRole('button', { name: '02 해결 계획', exact: true }).click();
    await expect(page.locator('#artifact')).not.toContainText('이 단계는 아직');
    await screenshot('06-plan.png');
  });
  await check('No uncaught browser JavaScript errors', async () => assert.deepEqual(errors, []));
} finally {
  report.completedAt = new Date().toISOString();
  report.passed = report.checks.length === 9 && report.checks.every((item) => item.passed);
  await writeFile(resolve(evidence, 'browser-check.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}

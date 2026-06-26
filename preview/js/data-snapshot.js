/**
 * preview/js/data-snapshot.js
 * 渲染快照检查工具库 — 轻量级, 无外部依赖
 *
 * 采样率 10%, 只检查有 data-snapshot 属性的元素
 * 差异异步上报到 /api render-check-report
 */

import { api } from './api.js';

const SAMPLE_RATE = 0.1;

export function initSnapshotCheck() {
  if (Math.random() > SAMPLE_RATE) return;
  document.querySelectorAll('[data-snapshot]').forEach(checkElement);
}

function checkElement(el) {
  const snapshotId = el.dataset.snapshot;
  const expected = el.dataset.expected;
  if (!snapshotId || !expected) return;

  let actual = '';
  if (snapshotId.startsWith('odds-')) {
    actual = JSON.stringify(
      Array.from(el.querySelectorAll('.odds-cell')).map(function (c) { return c.textContent.trim(); })
    );
  } else if (snapshotId.startsWith('score-')) {
    actual = el.textContent.trim().replace(/\s+/g, ' ');
  } else {
    actual = el.textContent.trim();
  }

  if (actual !== expected) {
    console.warn('[渲染差异] ' + snapshotId + ': 预期=' + expected + ', 实际=' + actual);
    reportDiff(snapshotId, expected, actual);
  }
}

async function reportDiff(snapshotId, expected, actual) {
  try {
    await api('render-check-report', {
      snapshotId: snapshotId,
      expected: expected,
      actual: actual,
      url: location.href,
    });
  } catch (e) {
    // silent
  }
}

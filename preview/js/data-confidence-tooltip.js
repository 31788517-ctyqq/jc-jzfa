/**
 * preview/js/data-confidence-tooltip.js
 * 浮动数据状态面板 — 页面右下角浮窗，点击展开数据状态一览
 *
 * 懒加载: main-fusion.js 启动后 3s 加载
 * 数据: 点击浮窗按钮时才调用 api('data-health', { days: 1 })
 * 互斥: admin 页面不显示
 */

import { api } from './api.js';

let _panelData = null;
let _panelVisible = false;

export function initDataConfidenceTooltip() {
  // 互斥: admin 页面不显示
  const activePage = document.querySelector('.page.active');
  if (activePage && activePage.id === 'page-admin') return;

  // 注入 DOM
  injectDOM();
}

function injectDOM() {
  if (document.getElementById('dcTooltip')) return;

  const btn = document.createElement('div');
  btn.id = 'dcTooltip';
  btn.innerHTML = '<button class="dc-float-btn" id="dcFloatBtn" onclick="window._toggleDcPanel()">📊<span class="dc-float-dot green" id="dcFloatDot"></span></button>';
  document.body.appendChild(btn);

  const panel = document.createElement('div');
  panel.id = 'dcTooltipPanel';
  panel.className = 'dc-panel';
  panel.style.display = 'none';
  panel.innerHTML =
    '<div class="dc-panel-header">数据状态<span class="dc-panel-close" onclick="window._toggleDcPanel()">✕</span></div>' +
    '<div class="dc-panel-body">' +
    '<div class="dc-panel-row"><span>数据来源</span><span id="dcPanelSources">--</span></div>' +
    '<div class="dc-panel-row"><span>健康数量</span><span id="dcPanelHealthy">--</span></div>' +
    '<div class="dc-panel-row"><span>数据来源</span><span id="dcPanelCount">--</span></div>' +
    '</div>' +
    '<div class="dc-panel-footer"><button onclick="window.switchTab(\'data-confidence\')">查看详细</button></div>';
  document.body.appendChild(panel);

  // 全局开关
  window._toggleDcPanel = function () {
    _panelVisible = !_panelVisible;
    const p = document.getElementById('dcTooltipPanel');
    if (!p) return;
    if (_panelVisible) {
      p.style.display = 'block';
      if (!_panelData) fetchPanelData();
    } else {
      p.style.display = 'none';
    }
  };
}

async function fetchPanelData() {
  try {
    const data = await api('data-health', { days: 1 });
    _panelData = data;
    updatePanel(data);
  } catch (e) {
    // silent
  }
}

function updatePanel(data) {
  const sources = data.fetchSources || {};
  const keys = Object.keys(sources);
  const total = keys.length;
  let healthy = 0;
  keys.forEach(function (k) {
    const rate = (sources[k].rate || 0) * 100;
    if (rate >= 80) healthy++;
  });

  const elSources = document.getElementById('dcPanelSources');
  const elHealthy = document.getElementById('dcPanelHealthy');
  const elCount = document.getElementById('dcPanelCount');

  if (elSources) elSources.textContent = total + '个';
  if (elHealthy) {
    elHealthy.textContent = healthy + '/' + total + ' ✅';
    elHealthy.style.color = healthy === total ? '#4caf50' : '#ff9800';
  }
  if (elCount) elCount.textContent = keys.slice(0, 4).join(' · ');

  // 更新浮窗圆点颜色
  const dot = document.getElementById('dcFloatDot');
  if (dot) {
    dot.className = 'dc-float-dot ' + (healthy === total ? 'green' : healthy >= total * 0.7 ? 'yellow' : 'red');
  }
}

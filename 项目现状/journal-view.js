/**
 * 看板「认领与台账」只读视图。数据由 node 项目现状/read-journal-view.mjs 生成的
 * journal-view-data.js 提供（window.ASTERHUB_JOURNAL_VIEW）；本脚本只渲染，不写台账。
 */
(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const grid = byId('journal-grid');
  const emptyState = byId('journal-empty');
  const freshness = byId('journal-freshness');
  const NO_RECORD = '尚未记录';
  const STATE_LABEL = { active: '占用中', stale: '断线（超 TTL）', free: '空闲', };

  function snapshot() {
    return window.ASTERHUB_JOURNAL_VIEW;
  }

  function display(value) {
    if (value === null || value === undefined || value === '') return NO_RECORD;
    if (typeof value === 'boolean' || typeof value === 'number') return String(value);
    if (typeof value === 'string') return value;
    return NO_RECORD;
  }

  function addText(parent, tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    parent.append(element);
    return element;
  }

  function ago(iso, now = Date.now()) {
    if (typeof iso !== 'string' || Number.isNaN(Date.parse(iso))) return NO_RECORD;
    const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    return `${Math.round(hours / 24)} 天前`;
  }

  function timeShort(iso) {
    if (typeof iso !== 'string' || Number.isNaN(Date.parse(iso))) return NO_RECORD;
    const date = new Date(iso);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function occupancyRow(state) {
    const row = document.createElement('div');
    row.className = 'handoff-row';
    addText(row, 'dt', '', `${state.task} · ${STATE_LABEL[state.state] ?? NO_RECORD}`);
    const detail = document.createElement('dd');
    const parts = [];
    if (state.claim) {
      parts.push(`owner=${state.claim.owner}`);
      parts.push(`上次活动 ${ago(state.claim.lastActivityAt)}`);
      parts.push(`TTL ${state.claim.ttlMinutes} 分钟`);
      if (Array.isArray(state.claim.files) && state.claim.files.length) {
        parts.push(`声明 ${state.claim.files.length} 项文件`);
      }
    }
    if (state.checkpoint) {
      parts.push(`断点：${state.checkpoint.next || NO_RECORD}`);
    }
    detail.textContent = parts.join(' · ');
    row.append(detail);
    return row;
  }

  function eventLine(event, task) {
    const item = document.createElement('li');
    const prefix = `${timeShort(event.at)} ${task || NO_RECORD} ${event.type} ${event.owner}`;
    item.textContent = event.summary ? `${prefix}：${event.summary}` : prefix;
    item.title = `${display(event.at)} · ${display(task)} · ${display(event.type)} · ${display(event.owner)}`;
    return item;
  }

  function renderOccupancy(view) {
    const card = byId('journal-occupancy-card');
    card.replaceChildren();
    addText(card, 'h3', '', '占用与断点总览');
    addText(card, 'p', 'handoff-purpose', `台账快照 ${display(view.generatedAt)} · 活跃占用 ${view.counts?.active ?? 0} · 断线 ${view.counts?.stale ?? 0} · 台账 ${view.counts?.journals ?? 0} 份`);
    const rows = document.createElement('dl');
    rows.className = 'handoff-rows';
    if (!Array.isArray(view.tasks) || view.tasks.length === 0) {
      addText(card, 'p', 'handoff-empty', 'journal/*.jsonl 尚无台账记录。');
    } else {
      for (const state of view.tasks) rows.append(occupancyRow(state));
    }
    card.append(rows);
    if (Array.isArray(view.boardPending) && view.boardPending.length) {
      const pendingFigure = document.createElement('p');
      pendingFigure.className = 'handoff-evidence';
      pendingFigure.textContent = `看板待办（无台账日志）：${view.boardPending.map(task => `${task.id}（${display(task.title)}）`).join(' · ')}`;
      card.append(pendingFigure);
    }
    if (Array.isArray(view.problems) && view.problems.length) {
      const problemLine = document.createElement('p');
      problemLine.className = 'handoff-evidence';
      problemLine.textContent = `台账校验问题：${view.problems.join('；')}`;
      card.append(problemLine);
    }
  }

  function renderEvents(view) {
    const card = byId('journal-events-card');
    card.replaceChildren();
    addText(card, 'h3', '', '最近台账事件');
    const events = [];
    for (const state of view.tasks ?? []) {
      for (const event of state.recent ?? []) events.push({ ...event, task: state.task });
    }
    events.sort((left, right) => (Date.parse(right.at) || 0) - (Date.parse(left.at) || 0));
    if (events.length === 0) {
      addText(card, 'p', 'handoff-empty', NO_RECORD);
      return;
    }
    const list = document.createElement('ul');
    list.className = 'handoff-list';
    for (const event of events.slice(0, 16)) list.append(eventLine(event));
    card.append(list);
  }

  function renderAll() {
    const view = snapshot();
    if (!view || typeof view !== 'object' || !Array.isArray(view.tasks)) {
      grid.hidden = true;
      emptyState.hidden = false;
      freshness.textContent = '台账快照：尚未生成';
      return;
    }
    emptyState.hidden = true;
    grid.hidden = false;
    freshness.textContent = `台账快照：${display(view.generatedAt)}`;
    renderOccupancy(view);
    renderEvents(view);
  }

  renderAll();
  window.addEventListener('asterhub:journals-updated', renderAll);
})();

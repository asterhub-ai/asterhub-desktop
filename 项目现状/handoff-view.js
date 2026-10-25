(() => {
  'use strict';

  const section = document.getElementById('agent-handoff');
  if (!section) return;

  const byId = id => document.getElementById(id);
  const purposeElement = byId('handoff-purpose');
  const usageDetails = byId('handoff-usage');
  const usageList = byId('handoff-usage-rules');
  const freshness = byId('handoff-freshness');
  const copyButton = byId('handoff-copy');
  const copyMessage = byId('handoff-copy-message');
  const copyFallback = byId('handoff-copy-fallback');
  const emptyState = byId('handoff-empty');
  const grid = byId('handoff-grid');
  const NO_RECORD = '尚未记录';

  // State read dynamically in renderAll
  function isPresent(value) {
    return value !== null && value !== undefined && value !== '' &&
      (!Array.isArray(value) || value.length > 0);
  }

  function display(value) {
    if (!isPresent(value)) return NO_RECORD;
    if (typeof value === 'boolean') return value ? '是' : '否';
    if (typeof value === 'number') return String(value);
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

  function setRows(card, title, entries) {
    card.replaceChildren();
    addText(card, 'h3', '', title);
    const rows = document.createElement('dl');
    rows.className = 'handoff-rows';
    for (const [label, value, useCode] of entries) {
      const row = document.createElement('div');
      row.className = 'handoff-row';
      addText(row, 'dt', '', label);
      const detail = document.createElement('dd');
      if (useCode) addText(detail, 'code', '', display(value));
      else detail.textContent = display(value);
      row.append(detail);
      rows.append(row);
    }
    card.append(rows);
  }

  function addList(parent, values, className = 'handoff-list') {
    if (!Array.isArray(values) || values.length === 0) {
      addText(parent, 'p', 'handoff-empty', NO_RECORD);
      return;
    }
    const list = document.createElement('ul');
    list.className = className;
    for (const value of values) {
      const item = document.createElement('li');
      item.textContent = display(value);
      list.append(item);
    }
    parent.append(list);
  }

  function repoEvidenceHref(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const candidate = value.match(/(?:^|[\s(])((?:[\w.\u4e00-\u9fff-]+[\\/])+[\w.\u4e00-\u9fff-]+\.(?:md|json|jsonl|log|txt|mjs|js|yml|yaml|ts|tsx|spec|html))(?:$|[\s#),;])/i);
    if (!candidate) return null;
    const path = candidate[1].replace(/\\/g, '/');
    if (path.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(path) || path.split('/').includes('..')) return null;
    return `../${path}`;
  }
  function appendPath(parent, path) {
    const shown = display(path);
    const href = repoEvidenceHref(path);
    if (!href) {
      parent.append(document.createTextNode(shown));
      return;
    }
    const link = document.createElement('a');
    link.href = href;
    link.textContent = shown;
    link.setAttribute('aria-label', `打开本地文件：${shown}`);
    parent.append(link);
  }

  function addEvidence(parent, evidence) {
    const paragraph = document.createElement('p');
    paragraph.className = 'handoff-evidence';
    const shown = display(evidence);
    paragraph.textContent = `证据：${shown}`;
    const href = repoEvidenceHref(evidence);
    if (href) {
      const link = document.createElement('a');
      link.href = href;
      link.textContent = '打开本地文件';
      link.setAttribute('aria-label', `打开本地证据：${shown}`);
      paragraph.append(document.createTextNode(' · '), link);
    }
    parent.append(paragraph);
  }


  function renderSource(source) {
    const snapshot = source && source.snapshot;
    setRows(byId('handoff-source-card'), '来源与快照', [
      ['仓库根目录', source && source.repoRoot, true],
      ['当前 worktree', source && source.worktree, true],
      ['已确认的受保护路径', Array.isArray(source && source.protectedPaths) && source.protectedPaths.length ? source.protectedPaths.join(' · ') : undefined, true],
      ['分支', source && source.branch, true],
      ['HEAD', source && source.head, true],
      ['快照编号', snapshot && snapshot.id, true],
      ['快照 SHA-256', snapshot && snapshot.sha256, true],
      ['快照是否含 T16', snapshot && snapshot.includesT16],
      ['当前改动范围', source && source.dirtyScope],
    ]);
  }

  function renderReadOrder(values) {
    const card = byId('handoff-read-order-card');
    card.replaceChildren();
    addText(card, 'h3', '', '最小读取顺序');
    addList(card, values);
  }

  function allocationSummary(values) {
    if (!Array.isArray(values) || values.length === 0) return NO_RECORD;
    return values.map(value => {
      if (typeof value === 'string') return value;
      if (!value || typeof value !== 'object') return NO_RECORD;
      const details = [value.id, value.status].filter(isPresent).map(display);
      return details.length ? details.join(' · ') : NO_RECORD;
    }).join(' | ');
  }
  function renderSlices(values) {
    const card = byId('handoff-slices-card');
    card.replaceChildren();
    addText(card, 'h3', '', '代理切片、作业与等待条件');
    if (!Array.isArray(values) || values.length === 0) {
      addText(card, 'p', 'handoff-empty', NO_RECORD);
      return;
    }
    const slices = document.createElement('div');
    slices.className = 'handoff-slices';
    for (const slice of values) {
      const item = document.createElement('details');
      item.className = 'handoff-item handoff-copy-disclosure handoff-slice-detail';
      item.open = false;
      addText(item, 'summary', 'handoff-slice-summary', `${display(slice && slice.owner)} · ${display(slice && slice.scope)}`);
      const detail = document.createElement('div');
      detail.className = 'handoff-slice-content';
      addText(detail, 'p', '', `工作范围：${display(slice && slice.scope)}`);
      const filesLine = document.createElement('p');
      filesLine.textContent = '负责文件：';
      if (Array.isArray(slice && slice.files) && slice.files.length) {
        slice.files.forEach((path, index) => {
          if (index) filesLine.append(document.createTextNode(' · '));
          appendPath(filesLine, path);
        });
      } else {
        filesLine.append(document.createTextNode(NO_RECORD));
      }
      detail.append(filesLine);
      addEvidence(detail, slice && slice.evidence);
      addText(detail, 'p', '', `显式分配：${allocationSummary(slice && slice.allocations)}`);
      addText(detail, 'p', '', `监控/观察条件：${display(slice && slice.monitor)}`);
      addText(detail, 'p', '', `等待：${display(slice && slice.waitFor)}`);
      const jobs = document.createElement('div');
      jobs.className = 'handoff-slices';
      if (Array.isArray(slice && slice.jobs) && slice.jobs.length) {
        for (const job of slice.jobs) {
          const jobCard = document.createElement('div');
          jobCard.className = 'handoff-job';
          addText(jobCard, 'h5', 'handoff-job-title', display(job && job.id));
          addText(jobCard, 'p', '', `状态：${display(job && job.status)}`);
          const allocation = Array.isArray(job && job.allocations)
            ? allocationSummary(job.allocations)
            : job && job.allocation;
          addText(jobCard, 'p', '', `Allocation：${display(allocation)}`);
          addText(jobCard, 'p', '', `监控：${display(job && job.monitor)}`);
          addText(jobCard, 'p', '', `等待：${display(job && job.waitFor)}`);
          addEvidence(jobCard, job && job.evidence);
          jobs.append(jobCard);
        }
      } else {
        addText(jobs, 'p', 'handoff-empty', '作业未记录');
      }
      detail.append(jobs);
      item.append(detail);
      slices.append(item);
    }
    card.append(slices);
  }

  function renderFiles(recentFiles) {
    const card = byId('handoff-files-card');
    card.replaceChildren();
    addText(card, 'h3', '', '改动文件与归属');
    const groups = [
      ['本轮已确认', recentFiles && recentFiles.confirmedRound],
      ['历史既有改动', recentFiles && recentFiles.historicalPreexisting],
      ['归属待核实', recentFiles && recentFiles.unknown],
    ];
    const content = document.createElement('div');
    content.className = 'handoff-slices';
    for (const [heading, entries] of groups) {
      const group = document.createElement('details');
      group.className = 'handoff-inventory-group handoff-copy-disclosure';
      const summaryText = Array.isArray(entries) && entries.length
        ? `${heading} · ${entries.length} 组`
        : `${heading} · ${NO_RECORD}`;
      addText(group, 'summary', 'handoff-group-title', summaryText);
      if (!Array.isArray(entries) || entries.length === 0) {
        addText(group, 'p', 'handoff-empty', NO_RECORD);
      } else {
        const list = document.createElement('div');
        list.className = 'handoff-items';
        for (const entry of entries) {
          const item = document.createElement('article');
          item.className = 'handoff-item';
          addText(item, 'p', '', `归属：${display(entry && entry.owner)}`);
          addText(item, 'p', '', `说明：${display(entry && entry.note)}`);
          const files = document.createElement('div');
          files.className = 'handoff-items';
          if (Array.isArray(entry && entry.files) && entry.files.length) {
            for (const path of entry.files) {
              const file = document.createElement('p');
              file.className = 'handoff-file-path';
              appendPath(file, path);
              files.append(file);
            }
          } else {
            addText(files, 'p', 'handoff-empty', NO_RECORD);
          }
          item.append(files);
          addEvidence(item, entry && entry.evidence);
          list.append(item);
        }
        group.append(list);
      }
      content.append(group);
    }
    card.append(content);
  }

  function renderVerifications(values) {
    const card = byId('handoff-verifications-card');
    card.replaceChildren();
    addText(card, 'h3', '', '最近验证与证据');
    if (!Array.isArray(values) || values.length === 0) {
      addText(card, 'p', 'handoff-empty', NO_RECORD);
      return;
    }
    const list = document.createElement('div');
    list.className = 'handoff-verifications';
    for (const verification of values) {
      const item = document.createElement('article');
      item.className = 'handoff-item';
      addText(item, 'h4', 'handoff-item-title', display(verification && verification.command));
      addText(item, 'p', '', `结果：${display(verification && verification.result)}`);
      addText(item, 'p', '', `归属：${display(verification && verification.owner)}`);
      addEvidence(item, verification && verification.evidence);
      list.append(item);
    }
    card.append(list);
  }

  function renderListCard(id, title, values) {
    const card = byId(id);
    card.replaceChildren();
    addText(card, 'h3', '', title);
    addList(card, values);
  }

  function renderInbox(inbox) {
    const card = byId('handoff-inbox-card');
    setRows(card, '问题收件箱', [
      ['文件', inbox && inbox.path, true],
      ['收件箱记录数', inbox && inbox.recordCount],
      ['待分诊数量', inbox && inbox.pendingCount],
      ['分诊规则', inbox && inbox.triageRule],
    ]);
    if (!Array.isArray(inbox && inbox.triage) || inbox.triage.length === 0) {
      addText(card, 'p', 'handoff-empty', '分诊记录：尚未记录');
      return;
    }
    const triageList = document.createElement('div');
    triageList.className = 'handoff-verifications';
    for (const entry of inbox.triage) {
      const item = document.createElement('details');
      item.className = 'handoff-job handoff-copy-disclosure handoff-triage-detail';
      const task = entry && Object.prototype.hasOwnProperty.call(entry, 'taskId') && entry.taskId === null
        ? '无（未关联产品待办）'
        : display(entry && entry.taskId);
      addText(item, 'summary', 'handoff-triage-summary', `${display(entry && entry.id)} · ${display(entry && entry.status)}`);
      const detail = document.createElement('div');
      addText(detail, 'p', '', `关联待办：${task}`);
      addText(detail, 'p', '', `说明：${display(entry && entry.note)}`);
      item.append(detail);
      triageList.append(item);
    }
    card.append(triageList);
  }

  function renderHandoff(record) {
    renderSource(record.source);
    renderReadOrder(record.readOrder);
    renderSlices(record.activeSlices);
    renderFiles(record.recentFiles);
    renderVerifications(record.latestVerification);
    renderListCard('handoff-next-card', '接续动作', record.nextActions);
    renderListCard('handoff-safety-card', '安全约束', record.doNot);
    renderInbox(record.inbox);
  }

  function textFromNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.replace(/\s+/g, ' ').trim();
    if (node.nodeType !== Node.ELEMENT_NODE || node.tagName === 'SUMMARY') return '';
    const parts = [...node.childNodes].map(textFromNode).filter(Boolean);
    if (!parts.length) return '';
    const inlineTags = new Set(['A', 'CODE', 'EM', 'SPAN', 'STRONG']);
    return parts.join(inlineTags.has(node.tagName) ? ' ' : '\n');
  }

  function textForCopy(element) {
    const visible = element.innerText.trim();
    const collapsedContent = [...element.querySelectorAll('.handoff-copy-disclosure:not([open])')]
      .map(group => [...group.childNodes]
        .filter(node => !(node.nodeType === Node.ELEMENT_NODE && node.tagName === 'SUMMARY'))
        .map(textFromNode)
        .filter(Boolean)
        .join('\n'))
      .filter(Boolean);
    return [visible, ...collapsedContent].filter(Boolean).join('\n\n');
  }

  function copySummary() {
    const sections = [purposeElement, freshness, ...grid.querySelectorAll('.handoff-card')];
    const lines = sections
      .filter(element => element && !element.hidden)
      .map(textForCopy)
      .filter(Boolean);
    const rules = [...usageList.querySelectorAll('li')].map(item => item.textContent);
    if (rules.length) lines.splice(2, 0, `Agent 使用规则\n${rules.map(rule => `• ${rule}`).join('\n')}`);
    return ['Agent 交接', ...lines].join('\n\n');
  }

  function renderAll() {
    const status = window.ASTERHUB_STATUS;
    const handoff = status && status.handoff;
    const purpose = status && status.purpose;
    const usageRules = status && status.usageRules;

    purposeElement.textContent = typeof purpose === 'string' && purpose.trim()
      ? purpose
      : '用途说明尚未记录。';

    if (Array.isArray(usageRules) && usageRules.length) {
      usageList.replaceChildren();
      addList(usageList, usageRules);
      usageDetails.hidden = false;
    } else {
      usageDetails.hidden = true;
    }

    if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff)) {
      copyButton.disabled = true;
      emptyState.hidden = false;
      grid.hidden = true;
      freshness.textContent = '交接快照：尚未记录';
    } else {
      emptyState.hidden = true;
      grid.hidden = false;
      freshness.replaceChildren();
      addText(freshness, 'strong', '', '快照时间');
      freshness.append(document.createTextNode(display(handoff.updatedAt)));
      renderHandoff(handoff);
      copyButton.disabled = false;
    }
  }

  renderAll();
  window.addEventListener('asterhub:status-updated', renderAll);

  copyButton.addEventListener('click', async () => {
    const summary = copySummary();
    copyFallback.value = summary;
    copyMessage.textContent = '';
    copyMessage.dataset.state = '';
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        throw new Error('当前浏览器未提供剪贴板写入权限。');
      }
      await navigator.clipboard.writeText(summary);
      copyFallback.hidden = true;
      copyMessage.textContent = '交接摘要已复制。';
      copyMessage.dataset.state = 'success';
    } catch {
      copyFallback.hidden = false;
      copyFallback.focus();
      copyFallback.select();
      copyMessage.textContent = '自动复制失败；下方文本已选中，可手动复制。';
      copyMessage.dataset.state = 'error';
    }
  });
})();

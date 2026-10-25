(() => {
  'use strict';

  const FILE_NAME = '问题提交记录.jsonl';
  const STORE_NAME = 'handles';
  const HANDLE_KEY = 'issue-directory';
  const DRAFT_KEY = 'asterhub.issue-submission.draft.v1';
  const LOCK_NAME = 'asterhub.issue-inbox.问题提交记录.jsonl';
  const form = document.getElementById('issue-submission-form');
  if (!form) return;

  const byId = id => document.getElementById(id);
  const fields = ['title', 'steps', 'actual', 'expected', 'notes'].map(name =>
    form.elements.namedItem(name),
  );
  const fieldByName = Object.fromEntries(fields.map(field => [field.name, field]));
  const binding = byId('issue-binding');
  const message = byId('issue-message');
  const submitButton = byId('issue-submit');
  const chooseButton = byId('issue-choose-directory');
  const recordsPanel = byId('issue-records');
  const recordList = byId('issue-record-list');
  const emptyRecords = byId('issue-records-empty');
  let directoryHandle = null;
  let fileHandle = null;
  let submitting = false;

  function setMessage(text, state = '') {
    message.textContent = text;
    message.dataset.state = state;
  }

  function setBinding(title, detail) {
    const strong = document.createElement('strong');
    strong.textContent = title;
    binding.replaceChildren(strong, document.createTextNode(detail));
  }

  function saveDraft() {
    const draft = Object.fromEntries(fields.map(field => [field.name, field.value]));
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      setMessage('浏览器无法保存本地草稿；当前页面仍保留已填写内容。', 'error');
    }
  }

  function restoreDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      for (const field of fields) {
        if (typeof draft[field.name] === 'string') field.value = draft[field.name];
      }
    } catch {
      setMessage('无法读取上次保留的草稿；当前表单仍可继续填写。', 'error');
    }
  }

  function clearDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // The record is already saved; keeping the draft is safer than risking data loss.
    }
  }

  function openHandleDatabase() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('当前浏览器无法记住本地文件夹授权，请每次重新选择项目文件夹。'));
        return;
      }
      const request = indexedDB.open('asterhub-issue-inbox', 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开本地授权存储。'));
      request.onblocked = () => reject(new Error('本地授权存储正被其他页面占用，请关闭重复看板后重试。'));
    });
  }

  async function saveDirectoryHandle(handle) {
    const db = await openHandleDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error('无法记住所选文件夹。'));
        transaction.onabort = () => reject(transaction.error || new Error('无法记住所选文件夹。'));
      });
    } finally {
      db.close();
    }
  }

  async function loadDirectoryHandle() {
    const db = await openHandleDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(HANDLE_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('无法读取已记住的文件夹授权。'));
      });
    } finally {
      db.close();
    }
  }

  function validateRecord(record, lineNumber) {
    const stringFields = ['title', 'steps', 'actual', 'expected', 'notes'];
    const recordFields = ['schemaVersion', 'id', 'submittedAt', ...stringFields];
    if (!record || typeof record !== 'object' || Array.isArray(record) ||
        Object.keys(record).length !== recordFields.length ||
        recordFields.some(key => !Object.prototype.hasOwnProperty.call(record, key)) ||
        record.schemaVersion !== 1 ||
        typeof record.id !== 'string' || !/^ISSUE-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.id) ||
        typeof record.submittedAt !== 'string' || !record.submittedAt.endsWith('Z') ||
        Number.isNaN(Date.parse(record.submittedAt)) ||
        stringFields.some(key => typeof record[key] !== 'string') ||
        !record.title.trim() || !record.actual.trim()) {
      throw new Error(`第 ${lineNumber} 行不是受支持的问题记录。为保护原文件，未写入。`);
    }
  }

  function recordsMatch(left, right) {
    return Object.keys(left).length === Object.keys(right).length &&
      Object.keys(left).every(key => Object.prototype.hasOwnProperty.call(right, key) && left[key] === right[key]);
  }

  function parseInbox(text) {
    if (text === '') return [];
    const lines = text.replace(/^\uFEFF/, '').split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    const records = [];
    const byRecordId = new Map();
    for (let index = 0; index < lines.length; index += 1) {
      const source = lines[index].replace(/\r$/, '');
      if (!source.trim()) continue;
      let record;
      try {
        record = JSON.parse(source);
      } catch {
        throw new Error(`第 ${index + 1} 行不是完整 JSON。为保护原文件，请先修复 JSONL 后再提交。`);
      }
      validateRecord(record, index + 1);
      const existing = byRecordId.get(record.id);
      if (existing && !recordsMatch(existing, record)) {
        throw new Error(`记录编号 ${record.id} 重复且内容冲突。为保护原文件，未写入。`);
      }
      if (!existing) {
        byRecordId.set(record.id, record);
        records.push(record);
      }
    }
    return records;
  }

  let lastLoadedRecords = [];

  function triagedSubmissionIds() {
    const status = window.ASTERHUB_STATUS;
    const seen = new Set();
    const tasks = status && Array.isArray(status.tasks) ? status.tasks : [];
    for (const task of tasks) {
      if (task && Array.isArray(task.submissionIds)) {
        for (const id of task.submissionIds) seen.add(id);
      }
    }
    const triage = status && status.handoff && status.handoff.inbox && Array.isArray(status.handoff.inbox.triage)
      ? status.handoff.inbox.triage
      : (status && Array.isArray(status.auxiliaryTriage) ? status.auxiliaryTriage : []);
    for (const entry of triage) {
      if (entry && typeof entry.id === 'string' && entry.status) seen.add(entry.id);
    }
    return seen;
  }

  function renderRecords(records) {
    if (Array.isArray(records)) {
      lastLoadedRecords = records;
    }
    recordsPanel.hidden = false;
    recordList.replaceChildren();
    const safeRecords = Array.isArray(records) ? records : (Array.isArray(lastLoadedRecords) ? lastLoadedRecords : []);
    emptyRecords.hidden = safeRecords.length > 0;
    const triaged = triagedSubmissionIds();
    const recent = safeRecords.slice(-5).reverse();
    for (const record of recent) {
      if (!record || typeof record !== 'object') continue;
      const article = document.createElement('article');
      article.className = 'issue-record';
      const summary = document.createElement('div');
      const title = document.createElement('h4');
      title.className = 'issue-record-title';
      title.textContent = record.title || '（未命名问题）';
      const meta = document.createElement('p');
      meta.className = 'issue-record-meta';
      meta.textContent = `${record.id || '未知ID'} · ${record.submittedAt || ''}`;
      summary.append(title, meta);
      const state = document.createElement('span');
      state.className = 'issue-record-state';
      const isTriaged = triaged.has(record.id);
      state.textContent = isTriaged ? '已分诊' : '已提交 · 待分诊';
      if (isTriaged) state.dataset.state = 'triaged';
      article.append(summary, state);
      recordList.append(article);
    }
  }

  window.addEventListener('asterhub:status-updated', () => {
    if (lastLoadedRecords.length > 0) {
      renderRecords(lastLoadedRecords);
    }
  });

  async function bindDirectory(handle, createInbox) {
    const permission = await handle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted' && createInbox) {
      const requested = await handle.requestPermission({ mode: 'readwrite' });
      if (requested !== 'granted') {
        directoryHandle = null;
        fileHandle = null;
        setBinding('等待文件夹授权', `请授权读写以打开 ${FILE_NAME}；提交内容尚未写入。`);
        return false;
      }
    } else if (permission !== 'granted') {
      return false;
    }
    const selectedFile = await handle.getFileHandle(FILE_NAME, { create: createInbox });
    const records = parseInbox(await (await selectedFile.getFile()).text());
    await saveDirectoryHandle(handle);
    directoryHandle = handle;
    fileHandle = selectedFile;
    renderRecords(records);
    setBinding('本地文件已绑定', `${FILE_NAME} · ${handle.name || '所选项目文件夹'}`);
    return true;
  }

  async function chooseDirectory() {
    setMessage('');
    if (typeof window.showDirectoryPicker !== 'function') {
      setMessage('此浏览器不支持直接写入本地文件。请使用支持 File System Access API 的最新版 Edge 或 Chrome；未提交任何内容。', 'error');
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'asterhub-issue-inbox' });
      if (await bindDirectory(handle, true)) {
        setMessage(`已绑定所选文件夹中的 ${FILE_NAME}。`, 'success');
      }
    } catch (error) {
      if (error && error.name === 'AbortError') {
        setMessage('已取消选择；草稿保持不变，尚未提交。');
        return;
      }
      directoryHandle = null;
      fileHandle = null;
      setBinding('尚未绑定保存位置', `文件夹选择或读取失败。请确认选择看板所在的“项目现状”文件夹，并检查 ${FILE_NAME} 是否损坏。`);
      setMessage(error && error.message
        ? `${error.message} 草稿保持不变，尚未提交。`
        : '无法绑定所选文件夹。草稿保持不变，尚未提交。', 'error');
    }
  }

  function readForm() {
    return Object.fromEntries(fields.map(field => [field.name, field.value.trim()]));
  }

  function validateForm(values) {
    for (const name of ['title', 'actual']) {
      const field = fieldByName[name];
      const invalid = !values[name];
      field.setAttribute('aria-invalid', String(invalid));
      if (invalid) {
        setMessage(name === 'title' ? '请填写问题标题。' : '请填写实际结果。', 'error');
        field.focus();
        return false;
      }
    }
    return true;
  }

  async function requireWritePermission() {
    if (!directoryHandle || !fileHandle) return false;
    const permission = await directoryHandle.queryPermission({ mode: 'readwrite' });
    if (permission === 'granted') return true;
    const requested = await directoryHandle.requestPermission({ mode: 'readwrite' });
    if (requested !== 'granted') {
      setMessage('文件夹读写权限未获准；草稿保持不变，尚未提交。', 'error');
      return false;
    }
    return true;
  }

  async function writeRecord(record) {
    let durableSaved = false;
    const appendUnderLock = async () => {
      const current = await fileHandle.getFile();
      const currentText = await current.text();
      const records = parseInbox(currentText);
      if (records.some(existing => existing.id === record.id)) {
        throw new Error('此提交编号已存在，未重复写入。请检查本地提交记录后再重试。');
      }
      const prefix = currentText.length === 0 || currentText.endsWith('\n') ? '' : '\n';
      const writer = await fileHandle.createWritable({ keepExistingData: true, mode: 'exclusive' });
      try {
        await writer.seek(current.size);
        await writer.write(`${prefix}${JSON.stringify(record)}\n`);
        await writer.close();
        durableSaved = true;
      } catch (error) {
        if (!durableSaved) {
          try { await writer.abort(); } catch { /* Preserve the original write error. */ }
        }
        throw error;
      }
      const readbackText = await (await fileHandle.getFile()).text();
      const readback = parseInbox(readbackText);
      if (!readback.some(saved => saved.id === record.id)) {
        const error = new Error('写入后未能在文件中找到本条记录。请检查文件后重试。');
        error.durableSaved = true;
        throw error;
      }
      return readback;
    };
    try {
      if (navigator.locks && typeof navigator.locks.request === 'function') {
        return await navigator.locks.request(LOCK_NAME, { mode: 'exclusive' }, appendUnderLock);
      }
      return await appendUnderLock();
    } catch (error) {
      if (durableSaved) error.durableSaved = true;
      throw error;
    }
  }

  function clearFormAfterSave() {
    for (const field of fields) {
      field.value = '';
      field.removeAttribute('aria-invalid');
    }
    clearDraft();
  }

  for (const field of fields) {
    field.addEventListener('input', () => {
      field.removeAttribute('aria-invalid');
      saveDraft();
    });
  }

  chooseButton.addEventListener('click', chooseDirectory);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting) return;
    setMessage('');
    const values = readForm();
    if (!validateForm(values)) return;
    if (!directoryHandle || !fileHandle) {
      setMessage(`请先选择看板所在的“项目现状”文件夹，文件名固定为 ${FILE_NAME}。草稿已保留。`, 'error');
      chooseButton.focus();
      return;
    }
    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = '正在保存…';
    let savedRecord = null;
    let durableSaved = false;
    try {
      if (!(await requireWritePermission())) return;
      const record = {
        schemaVersion: 1,
        id: `ISSUE-${crypto.randomUUID()}`,
        submittedAt: new Date().toISOString(),
        title: values.title,
        steps: values.steps,
        actual: values.actual,
        expected: values.expected,
        notes: values.notes,
      };
      savedRecord = record;
      const records = await writeRecord(record);
      durableSaved = true;
      clearFormAfterSave();
      try {
        renderRecords(records);
      } catch (renderError) {
        console.error('渲染记录列表失败', renderError);
      }
      setMessage(`问题已保存到本地文件，编号 ${record.id}。此记录仅代表已提交，尚未表示已分诊或修复。`, 'success');
    } catch (error) {
      if (durableSaved || (error && error.durableSaved)) {
        clearFormAfterSave();
        const idInfo = savedRecord ? `，编号 ${savedRecord.id}` : '';
        setMessage(`问题已写入本地文件${idInfo}，但界面后续展示出错：${error && error.message ? error.message : '未知错误'}。草稿已保存并清理，请勿重复提交。`, 'warning');
      } else {
        const detail = error && error.message ? ` ${error.message}` : '';
        setMessage(`写入失败；草稿保持不变，尚未确认提交。检查文件夹权限、磁盘空间及 JSONL 内容后重试。${detail}`, 'error');
      }
    } finally {
      submitting = false;
      submitButton.disabled = false;
      submitButton.textContent = '提交到本地';
    }
  });

  async function restoreBinding() {
    if (typeof window.showDirectoryPicker !== 'function') {
      setBinding('当前浏览器不支持直接写入', '请使用支持 File System Access API 的最新版 Edge 或 Chrome；不会改用浏览器存储代替文件提交。');
      return;
    }
    try {
      const handle = await loadDirectoryHandle();
      if (!handle) return;
      const permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission === 'granted') {
        await bindDirectory(handle, false);
      } else {
        setBinding('本地位置已记住，等待重新授权', `刷新后浏览器可能要求重新授权；提交时或重新选择项目文件夹。目标文件：${FILE_NAME}。`);
      }
    } catch (error) {
      setBinding('尚未选择保存位置', `无法恢复先前授权，请重新选择看板所在的“项目现状”文件夹。${error && error.message ? ` ${error.message}` : ''}`);
    }
  }

  restoreDraft();
  restoreBinding();
})();

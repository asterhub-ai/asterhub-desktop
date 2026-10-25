#!/usr/bin/env node
/** 只读台账视图数据生成器（看板 index.html「认领与台账」区块）。
 * 扫描 项目现状/journal/*.jsonl，按 handoff.mjs 的同一派生规则计算占用与断点，
 * 生成静态 journal-view-data.js（window.ASTERHUB_JOURNAL_VIEW）。不写台账、不改协议状态。 */
import { readFile, readdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const directory = path.dirname(fileURLToPath(import.meta.url));
const journalDir = path.join(directory, 'journal');
const outputFile = path.join(directory, 'journal-view-data.js');
const statusFile = path.join(directory, 'status-data.js');
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/;
const DEFAULT_TTL_MINUTES = 240;
const TYPE_KEYS = {
  claim: new Set(['ttlMinutes', 'files', 'tookOverFrom', 'forced']),
  checkpoint: new Set(['next', 'done', 'rejected', 'evidence', 'text']),
  note: new Set(['text', 'rejected', 'evidence']),
  release: new Set(['reason']),
};
const TEXT_FIELD = { note: 'text', checkpoint: 'next' };
const RECENT_LIMIT = 6;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function flatten(text, limit = 160) {
  if (!isNonEmptyString(text)) return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

function validateEvent(record, where) {
  const fail = message => problems.push(`${where}: ${message}`);
  if (!record || typeof record !== 'object' || Array.isArray(record)) return fail('事件不是对象。');
  const base = ['v', 'id', 'task', 'type', 'owner', 'at'];
  const allowedKeys = new Set([...base, ...(TYPE_KEYS[record.type] ?? [])]);
  if (record.v !== 1) fail('v 必须为 1。');
  if (!isNonEmptyString(record.id)) fail('id 不能为空。');
  if (!isNonEmptyString(record.task) || !TASK_ID.test(record.task)) fail(`task 非法: ${record.task}。`);
  if (!Object.prototype.hasOwnProperty.call(TYPE_KEYS, record.type)) fail(`type 非法: ${record.type}。`);
  if (!isNonEmptyString(record.owner) || record.owner.length > 64) fail('owner 非法。');
  if (typeof record.at !== 'string' || !record.at.endsWith('Z') || Number.isNaN(Date.parse(record.at))) fail('at 必须为 ISO 时间。');
  if (!isNonEmptyString(record.type) || !Object.keys(record).every(key => allowedKeys.has(key))) {
    fail(`字段集合不合法（type=${record.type}）。`);
  }
  if (record.type === 'checkpoint' && !isNonEmptyString(record.next)) fail('checkpoint 必须有非空 next。');
  if (record.type === 'note' && !isNonEmptyString(record.text)) fail('note 必须有非空 text。');
}

function deriveState(events, now, task) {
  let claim = null;
  for (const event of events) {
    if (event.type === 'claim') {
      claim = {
        owner: event.owner,
        at: event.at,
        ttlMinutes: event.ttlMinutes ?? DEFAULT_TTL_MINUTES,
        files: event.files ?? [],
        lastActivityAt: event.at,
        tookOverFrom: event.tookOverFrom,
        forced: event.forced === true,
      };
    } else if (event.type === 'release') {
      claim = null;
    } else if (claim && event.owner === claim.owner && Date.parse(event.at) >= Date.parse(claim.at)) {
      claim.lastActivityAt = event.at;
    }
  }
  let checkpoint = null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === 'checkpoint') { checkpoint = events[index]; break; }
  }
  let lastEvent = events.length ? events[events.length - 1] : null;
  const active = checkpoint && claim && claim.owner === checkpoint.owner && Date.parse(checkpoint.at) >= Date.parse(claim.at);
  return {
    task,
    eventCount: events.length,
    lastEventAt: lastEvent ? lastEvent.at : null,
    claim: claim ? {
      owner: claim.owner,
      claimedAt: claim.at,
      ttlMinutes: claim.ttlMinutes,
      files: claim.files,
      tookOverFrom: claim.tookOverFrom ?? null,
      lastActivityAt: claim.lastActivityAt,
      idleMinutes: Math.max(0, Math.round((now - Date.parse(claim.lastActivityAt)) / 60_000)),
      stale: now - Date.parse(claim.lastActivityAt) > claim.ttlMinutes * 60_000,
      hasCheckpointSinceClaim: active,
    } : null,
    checkpoint: checkpoint ? {
      at: checkpoint.at,
      owner: checkpoint.owner,
      next: flatten(checkpoint.next),
      doneCount: Array.isArray(checkpoint.done) ? checkpoint.done.length : 0,
      rejectedCount: Array.isArray(checkpoint.rejected) ? checkpoint.rejected.length : 0,
      evidence: checkpoint.evidence ? flatten(checkpoint.evidence, 96) : null,
    } : null,
    recent: events.slice(-RECENT_LIMIT).map(event => ({
      type: event.type,
      owner: event.owner,
      at: event.at,
      summary: flatten(event.type === 'note' ? event.text : event.type === 'release' ? (event.reason ?? '') : (event.next ?? ''), 120),
    })),
  };
}

async function readJournalFile(file) {
  const source = await readFile(file, 'utf8');
  const events = [];
  const lines = source.replace(/^\uFEFF/, '').split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (!raw.trim()) continue;
    let record;
    try {
      record = JSON.parse(raw);
    } catch (error) {
      problems.push(`${path.basename(file)} 第 ${index + 1} 行不是完整 JSON（${error.message}）；该任务视图数据被跳过。`);
      return null;
    }
    validateEvent(record, `${path.basename(file)} 第 ${index + 1} 行`);
    events.push(record);
  }
  return events;
}

async function readBoardTasks() {
  let source;
  try {
    source = await readFile(statusFile, 'utf8');
  } catch (error) {
    return { error: `无法读取 status-data.js: ${error.message}`, tasks: [] };
  }
  try {
    const sandbox = { window: {} };
    vm.runInNewContext(source, sandbox, { filename: statusFile, timeout: 1000 });
    const data = sandbox.window.ASTERHUB_STATUS;
    if (!data || !Array.isArray(data.tasks)) return { error: 'status-data.js 缺少 ASTERHUB_STATUS.tasks 数组。', tasks: [] };
    return {
      error: null,
      tasks: data.tasks
        .filter(task => task && typeof task.id === 'string' && (task.status === 'pending' || task.status === 'partial'))
        .map(task => ({ id: task.id, title: flatten(task.title, 60), status: task.status })),
    };
  } catch (error) {
    return { error: `无法解析 status-data.js: ${error.message}`, tasks: [] };
  }
}

const problems = [];
try {
  const entries = await readdir(journalDir, { withFileTypes: true });
  const journalFiles = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl') && TASK_ID.test(entry.name.replace(/\.jsonl$/, '')))
    .map(entry => path.join(journalDir, entry.name));
  const now = Date.now();
  const states = [];
  for (const file of journalFiles) {
    const task = path.basename(file).replace(/\.jsonl$/, '');
    const events = await readJournalFile(file);
    if (events === null) continue;
    const state = deriveState(events, now, task);
    state.state = state.claim === null ? 'free' : (state.claim.stale ? 'stale' : 'active');
    states.push(state);
  }
  states.sort((left, right) => {
    const rank = { active: 0, stale: 1, free: 2 };
    if (rank[left.state] !== rank[right.state]) return rank[left.state] - rank[right.state];
    return (Date.parse(right.lastEventAt ?? 0) || 0) - (Date.parse(left.lastEventAt ?? 0) || 0);
  });
  const board = await readBoardTasks();
  if (board.error) problems.push(board.error);
  const boardPending = board.tasks.filter(task => !states.some(state => state.task === task.id));
  const generatedAt = new Date().toISOString();
  const snapshot = {
    schemaVersion: 1,
    generatedAt,
    defaultTtlMinutes: DEFAULT_TTL_MINUTES,
    counts: {
      journals: states.length,
      active: states.filter(state => state.state === 'active').length,
      stale: states.filter(state => state.state === 'stale').length,
    },
    tasks: states,
    boardPending,
    problems,
  };
  const body = `// 自动生成于 ${generatedAt}：node 项目现状/read-journal-view.mjs。只读快照；台账本体 journal/*.jsonl 与 handoff.mjs 输出仍是权威。\nwindow.ASTERHUB_JOURNAL_VIEW = ${JSON.stringify(snapshot, null, 2)};\n`;
  const tmpFile = `${outputFile}.tmp-${process.pid}`;
  await writeFile(tmpFile, body, 'utf8');
  await rename(tmpFile, outputFile);
  process.stdout.write(`${JSON.stringify({
    output: outputFile,
    journals: states.length,
    active: snapshot.counts.active,
    stale: snapshot.counts.stale,
    boardPending: boardPending.length,
    problems: problems.length,
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}

#!/usr/bin/env node
/** 项目现状 per-task handoff ledger: append-only journals + claim protocol. Rules: 交接协议.md. */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const execFileAsync = promisify(execFile);
const directory = path.dirname(fileURLToPath(import.meta.url));
const journalDir = path.join(directory, 'journal');
const statusFile = path.join(directory, 'status-data.js');
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/;
const DEFAULT_TTL_MINUTES = 240;
const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 5_000;
const MULTI_KEYS = new Set(['done', 'rejected', 'files']);
const SINGLE_KEYS = new Set(['owner', 'next', 'text', 'evidence', 'reason', 'ttl-minutes']);
const TYPE_KEYS = {
  claim: new Set(['ttlMinutes', 'files', 'tookOverFrom', 'forced']),
  checkpoint: new Set(['next', 'done', 'rejected', 'evidence', 'text']),
  note: new Set(['text', 'rejected', 'evidence']),
  release: new Set(['reason']),
};

const USAGE = `用法: node 项目现状/handoff.mjs <命令> [参数]
命令:
  status                        占用与断点总览（含看板待办）
  brief <task>                  生成接手简报：任务卡 + 断点 + 占用 + 硬约束
  claim <task> --owner <名> [--files 路径]... [--ttl-minutes N] [--force]
  checkpoint <task> --owner <名> --next "下一步" [--done 条目]... [--rejected 已排除项]... [--evidence 路径] [--text 说明]
  note <task> --owner <名> --text "发现" [--rejected 已排除项]... [--evidence 路径]
  release <task> --owner <名> --next "接手者下一步" [--reason 原因]
  check                         校验台账不变量（活跃认领须有 checkpoint / TTL 断线 / 文件冲突）
规则见 交接协议.md：写入要求活跃认领；release 强制留下最终 checkpoint。`;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function parseArgs(argv) {
  const parsed = { _: [], done: [], rejected: [], files: [], force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      parsed._.push(token);
      continue;
    }
    const key = token.slice(2);
    if (key === 'force') {
      parsed.force = true;
      continue;
    }
    if (!MULTI_KEYS.has(key) && !SINGLE_KEYS.has(key)) throw new Error(`未知参数 ${token}。`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${token} 缺少取值。`);
    index += 1;
    if (key === 'ttl-minutes') {
      const minutes = Number(value);
      if (!Number.isInteger(minutes) || minutes <= 0) throw new Error('--ttl-minutes 须为正整数。');
      parsed.ttlMinutes = minutes;
    } else if (MULTI_KEYS.has(key)) {
      parsed[key].push(...value.split(',').map(item => item.trim()).filter(Boolean));
    } else {
      parsed[key] = value;
    }
  }
  return parsed;
}

function requireOwner(parsed) {
  if (!isNonEmptyString(parsed.owner) || parsed.owner.length > 64) {
    throw new Error('必须提供 --owner（1–64 字符的稳定 Agent 身份名，如 ZCode-main、OMP-1、产品本体）。');
  }
}

function requireTask(task) {
  if (!TASK_ID.test(task)) {
    throw new Error(`任务号非法: ${task}。须为 1–48 位 ASCII（字母开头，可含数字._-），如 T16、BUG-crash、AUX-1。`);
  }
}

function validateEvent(record, where) {
  const fail = message => { throw new Error(`${where}: ${message}`); };
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail('事件不是对象。');
  const base = ['v', 'id', 'task', 'type', 'owner', 'at'];
  const allowed = new Set([...base, ...(TYPE_KEYS[record.type] ?? [])]);
  const keys = Object.keys(record);
  if (!base.every(key => key in record) || keys.some(key => !allowed.has(key))) {
    fail(`字段集合不合法（type=${record.type}）。`);
  }
  if (record.v !== 1) fail('v 必须为 1。');
  if (!isNonEmptyString(record.id)) fail('id 不能为空。');
  if (!isNonEmptyString(record.task) || !TASK_ID.test(record.task)) fail(`task 非法: ${record.task}。`);
  if (!Object.prototype.hasOwnProperty.call(TYPE_KEYS, record.type)) fail(`type 非法: ${record.type}。`);
  if (!isNonEmptyString(record.owner) || record.owner.length > 64) fail('owner 非法。');
  if (typeof record.at !== 'string' || !record.at.endsWith('Z') || Number.isNaN(Date.parse(record.at))) fail('at 必须为 ISO 时间。');
  if (record.type === 'claim') {
    if (record.ttlMinutes !== undefined && (!Number.isInteger(record.ttlMinutes) || record.ttlMinutes <= 0)) fail('ttlMinutes 须为正整数。');
    if (record.files !== undefined && (!Array.isArray(record.files) || record.files.some(item => !isNonEmptyString(item)))) fail('files 须为非空字符串数组。');
    if (record.tookOverFrom !== undefined && !isNonEmptyString(record.tookOverFrom)) fail('tookOverFrom 不能为空。');
    if (record.forced !== undefined && typeof record.forced !== 'boolean') fail('forced 须为布尔值。');
  }
  if (record.type === 'checkpoint' && !isNonEmptyString(record.next)) fail('checkpoint 必须有非空 next。');
  if (record.type === 'note' && !isNonEmptyString(record.text)) fail('note 必须有非空 text。');
  for (const key of ['done', 'rejected']) {
    if (record[key] !== undefined && (!Array.isArray(record[key]) || record[key].some(item => !isNonEmptyString(item)))) fail(`${key} 须为非空字符串数组。`);
  }
  if (record.evidence !== undefined && !isNonEmptyString(record.evidence)) fail('evidence 不能为空。');
  if (record.text !== undefined && !isNonEmptyString(record.text)) fail('text 不能为空。');
  if (record.reason !== undefined && !isNonEmptyString(record.reason)) fail('reason 不能为空。');
}

async function readJournal(task) {
  const file = path.join(journalDir, `${task}.jsonl`);
  let source;
  try {
    source = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error(`无法读取 ${file}: ${error.message}`);
  }
  const events = [];
  const lines = source.replace(/^\uFEFF/, '').split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (!raw.trim()) continue;
    let record;
    try {
      record = JSON.parse(raw);
    } catch {
      throw new Error(`${task}.jsonl 第 ${index + 1} 行不是完整 JSON；为保护台账已停止。`);
    }
    validateEvent(record, `${task}.jsonl 第 ${index + 1} 行`);
    events.push(record);
  }
  return events;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withJournalLock(task, action) {
  const lockDir = path.join(journalDir, `${task}.jsonl.lock`);
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      await mkdir(lockDir, { recursive: false });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let ageMs = Infinity;
      try {
        ageMs = Date.now() - (await stat(lockDir)).mtimeMs;
      } catch { /* Lock vanished between mkdir failure and stat; retry immediately. */ }
      if (ageMs > LOCK_STALE_MS) {
        await rm(lockDir, { recursive: true, force: true }).catch(() => {});
        continue;
      }
      if (Date.now() > deadline) throw new Error(`${task} 的台账正被其他进程写入（锁等待超时）。稍后重试。`);
      await sleep(80);
    }
  }
  try {
    await writeFile(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    return await action();
  } finally {
    await rm(lockDir, { recursive: true, force: true }).catch(() => {});
  }
}

function baseEvent(task, owner, type) {
  return { v: 1, id: randomUUID(), task, type, owner, at: new Date().toISOString() };
}

async function appendEvents(task, newEvents) {
  await mkdir(journalDir, { recursive: true });
  await withJournalLock(task, async () => {
    const file = path.join(journalDir, `${task}.jsonl`);
    let prefix = '';
    try {
      const existing = await readFile(file, 'utf8');
      if (existing && !existing.endsWith('\n')) prefix = '\n';
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    for (const event of newEvents) validateEvent(event, '新事件');
    const lines = newEvents.map(event => JSON.stringify(event)).join('\n');
    await appendFile(file, `${prefix}${lines}\n`);
  });
}

function deriveState(events, now = Date.now()) {
  let claim = null;
  for (const event of events) {
    if (event.type === 'claim') {
      claim = {
        owner: event.owner,
        at: event.at,
        ttlMinutes: event.ttlMinutes ?? DEFAULT_TTL_MINUTES,
        files: event.files ?? [],
        lastActivity: event.at,
      };
    } else if (event.type === 'release') {
      claim = null;
    } else if (claim && event.owner === claim.owner && Date.parse(event.at) >= Date.parse(claim.at)) {
      claim.lastActivity = event.at;
    }
  }
  if (claim) {
    claim.idleMs = now - Date.parse(claim.lastActivity);
    claim.stale = claim.idleMs > claim.ttlMinutes * 60_000;
  }
  const lastCheckpoint = [...events].reverse().find(event => event.type === 'checkpoint') ?? null;
  return { claim, lastCheckpoint, events };
}

function hasCheckpointSinceClaim(state) {
  if (!state.claim) return false;
  const claimedAt = Date.parse(state.claim.at);
  return state.events.some(event => event.type === 'checkpoint'
    && event.owner === state.claim.owner && Date.parse(event.at) >= claimedAt);
}

async function loadStatus() {
  let source;
  try {
    source = await readFile(statusFile, 'utf8');
  } catch (error) {
    return { error: `无法读取 status-data.js: ${error.message}` };
  }
  try {
    const sandbox = { window: {} };
    vm.runInNewContext(source, sandbox, { filename: statusFile, timeout: 1000 });
    const data = sandbox.window.ASTERHUB_STATUS;
    if (!data || typeof data !== 'object' || !Array.isArray(data.tasks)) {
      return { error: 'status-data.js 缺少 ASTERHUB_STATUS.tasks 数组。' };
    }
    return { data };
  } catch (error) {
    return { error: `无法解析 status-data.js: ${error.message}` };
  }
}

function fmtAge(iso, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

function truncate(text, length = 80) {
  if (!isNonEmptyString(text)) return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

async function requireActiveClaim(task, owner, force, action) {
  const state = deriveState(await readJournal(task));
  if (!state.claim) {
    throw new Error(`${task} 当前没有活跃认领。按交接协议铁律 1，先 claim 再${action}。`);
  }
  if (state.claim.owner !== owner && !force) {
    throw new Error(`${task} 当前由 ${state.claim.owner} 认领（上次活动 ${fmtAge(state.claim.lastActivity)}）；owner 不符。`);
  }
  return state;
}

async function cmdClaim(parsed) {
  const [task] = parsed._.slice(1);
  if (!task) throw new Error('claim 需要任务号。见 --help。');
  requireTask(task);
  requireOwner(parsed);
  const state = deriveState(await readJournal(task));
  const event = baseEvent(task, parsed.owner, 'claim');
  if (state.claim) {
    const { owner, stale, lastActivity } = state.claim;
    if (owner === parsed.owner) throw new Error(`${task} 已由 ${parsed.owner} 认领，无需重复认领；直接继续 note/checkpoint。`);
    if (!stale && !parsed.force) {
      throw new Error(`${task} 正被 ${owner} 占用（上次活动 ${fmtAge(lastActivity)}，TTL ${state.claim.ttlMinutes} 分钟）。与对方协调，或确认其断线后 --force 接管。`);
    }
    event.tookOverFrom = owner;
  }
  event.ttlMinutes = parsed.ttlMinutes ?? DEFAULT_TTL_MINUTES;
  if (parsed.files.length) event.files = parsed.files;
  if (parsed.force) event.forced = true;
  await appendEvents(task, [event]);
  const tookOver = event.tookOverFrom ? `（接管自 ${event.tookOverFrom}${event.forced ? '，强制' : '，原认领已断线'}）` : '';
  console.log(`已认领 ${task} · owner=${event.owner} · TTL=${event.ttlMinutes} 分钟${tookOver}。`);
  if (parsed.files.length) console.log(`声明文件：\n  - ${parsed.files.join('\n  - ')}`);
  console.log('铁律 2 生效：每个有意义的步骤后立即 checkpoint；额度紧张先落 checkpoint 再继续。');
}

async function cmdCheckpoint(parsed) {
  const [task] = parsed._.slice(1);
  if (!task) throw new Error('checkpoint 需要任务号。');
  requireTask(task);
  requireOwner(parsed);
  if (!isNonEmptyString(parsed.next)) throw new Error('checkpoint 必须提供 --next（下一步，写到命令级具体；这是接手者的起点）。');
  await requireActiveClaim(task, parsed.owner, false, '记录 checkpoint');
  const event = baseEvent(task, parsed.owner, 'checkpoint');
  event.next = parsed.next;
  if (parsed.done.length) event.done = parsed.done;
  if (parsed.rejected.length) event.rejected = parsed.rejected;
  if (isNonEmptyString(parsed.evidence)) event.evidence = parsed.evidence;
  if (isNonEmptyString(parsed.text)) event.text = parsed.text;
  await appendEvents(task, [event]);
  console.log(`已落 checkpoint：${task} · next="${truncate(parsed.next)}"。断点已更新，额度墙切断也不丢。`);
}

async function cmdNote(parsed) {
  const [task] = parsed._.slice(1);
  if (!task) throw new Error('note 需要任务号。');
  requireTask(task);
  requireOwner(parsed);
  if (!isNonEmptyString(parsed.text)) throw new Error('note 必须提供 --text。');
  await requireActiveClaim(task, parsed.owner, false, '记录 note');
  const event = baseEvent(task, parsed.owner, 'note');
  event.text = parsed.text;
  if (parsed.rejected.length) event.rejected = parsed.rejected;
  if (isNonEmptyString(parsed.evidence)) event.evidence = parsed.evidence;
  await appendEvents(task, [event]);
  console.log(`已记 note：${task} · "${truncate(parsed.text)}"。`);
}

async function cmdRelease(parsed) {
  const [task] = parsed._.slice(1);
  if (!task) throw new Error('release 需要任务号。');
  requireTask(task);
  requireOwner(parsed);
  if (!isNonEmptyString(parsed.next)) {
    throw new Error('release 必须携带 --next（接手者的下一步）。铁律 3：不允许空手离场；额度墙前的最后动作永远是 checkpoint。');
  }
  const state = await requireActiveClaim(task, parsed.owner, parsed.force, 'release');
  const checkpoint = baseEvent(task, state.claim.owner, 'checkpoint');
  checkpoint.next = parsed.next;
  if (parsed.done.length) checkpoint.done = parsed.done;
  const release = baseEvent(task, state.claim.owner, 'release');
  if (isNonEmptyString(parsed.reason)) release.reason = parsed.reason;
  if (parsed.force && state.claim.owner !== parsed.owner) release.reason = `${release.reason ?? ''}（force 释放原认领 ${state.claim.owner}）`.trim();
  await appendEvents(task, [checkpoint, release]);
  console.log(`已写入最终 checkpoint 并释放 ${task}。接手者跑 brief ${task} 即可从断点继续。`);
}

async function gitStatusFor(repoRoot, files) {
  if (!repoRoot || !files.length || !existsSync(repoRoot)) return null;
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoRoot, 'status', '--porcelain', '--', ...files], { timeout: 10_000, encoding: 'utf8' });
    return stdout.trim();
  } catch (error) {
    return `(git 状态读取失败: ${error.message})`;
  }
}

async function cmdBrief(parsed) {
  const [task] = parsed._.slice(1);
  if (!task) throw new Error('brief 需要任务号。');
  requireTask(task);
  const status = await loadStatus();
  const card = status.data ? status.data.tasks.find(item => item.id === task) : null;
  const handoff = status.data?.handoff ?? null;
  const lines = [];
  lines.push(`# 任务简报 · ${task}（生成于 ${new Date().toISOString()}）`);
  lines.push('');
  lines.push('## 任务卡（权威层 · status-data.js）');
  if (card) {
    lines.push(`- 标题：${card.title ?? ''}`);
    lines.push(`- 状态：${card.status ?? ''} · ${card.label ?? ''} · 优先级 ${card.priority ?? ''}`);
    if (card.detail) lines.push(`- 详情：${card.detail}`);
    if (card.acceptance) lines.push(`- 验收：${card.acceptance}`);
    if (card.source) lines.push(`- 源码入口：${card.source}`);
  } else if (status.error) {
    lines.push(`- ⚠ ${status.error}`);
    lines.push(`- ${task} 未在看板任务卡中找到。`);
  } else {
    lines.push(`- ${task} 未在看板任务卡中（看板外任务：临时 BUG / 辅助工作等，正常）。`);
  }
  const events = await readJournal(task);
  const state = deriveState(events);
  lines.push('');
  lines.push('## 当前占用');
  if (state.claim) {
    const flag = state.claim.stale ? '（⚠ 超过 TTL 无活动，疑似断线，可直接接管）' : '';
    lines.push(`- owner=${state.claim.owner} · 上次活动 ${fmtAge(state.claim.lastActivity)} · TTL ${state.claim.ttlMinutes} 分钟${flag}`);
    if (state.claim.files.length) lines.push(`- 声明文件：\n  - ${state.claim.files.join('\n  - ')}`);
  } else {
    lines.push('- 未占用（可直接 claim）。');
  }
  lines.push('');
  lines.push('## 断点（最近 checkpoint）');
  if (state.lastCheckpoint) {
    const point = state.lastCheckpoint;
    lines.push(`- ${point.at} · ${point.owner}`);
    lines.push(`- next：${point.next}`);
    for (const item of point.done ?? []) lines.push(`- 已完成：${item}`);
    for (const item of point.rejected ?? []) lines.push(`- 已排除：${item}`);
    if (point.evidence) lines.push(`- 证据：${point.evidence}`);
    const pointIndex = events.indexOf(point);
    const tail = events.slice(pointIndex + 1);
    if (tail.length) {
      lines.push('');
      lines.push('## 断点之后的事件');
      for (const event of tail) {
        const body = event.next ?? event.text ?? event.reason ?? '';
        lines.push(`- [${event.type}] ${event.owner} · ${fmtAge(event.at)}：${truncate(body)}`);
      }
    }
  } else if (events.length) {
    lines.push(`- ⚠ 该任务有日志但从未 checkpoint。最近 ${Math.min(5, events.length)} 条：`);
    for (const event of events.slice(-5)) lines.push(`- [${event.type}] ${event.owner} · ${fmtAge(event.at)}：${truncate(event.next ?? event.text ?? '')}`);
  } else {
    lines.push('- 该任务尚无日志；从任务卡与硬约束开始，认领后随手记。');
  }
  lines.push('');
  lines.push('## 全局硬约束（doNot）');
  for (const rule of handoff?.doNot ?? ['（status-data.js 不可读，约束清单缺失；先修复再开工。）']) lines.push(`- ${rule}`);
  if (handoff?.source?.repoRoot && state.claim?.files.length) {
    const gitStatus = await gitStatusFor(handoff.source.repoRoot, state.claim.files);
    if (gitStatus) {
      lines.push('');
      lines.push(`## 声明文件的 git 状态（${handoff.source.repoRoot}）`);
      lines.push(gitStatus.split('\n').map(line => `- ${line}`).join('\n'));
    }
  }
  console.log(lines.join('\n'));
}

async function listJournals() {
  try {
    const names = await readdir(journalDir);
    return names.filter(name => name.endsWith('.jsonl')).map(name => name.slice(0, -'.jsonl'.length)).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function cmdStatus() {
  const status = await loadStatus();
  const tasks = new Map((status.data?.tasks ?? []).map(task => [task.id, task]));
  const journals = await listJournals();
  const rows = [];
  for (const task of journals) {
    const state = deriveState(await readJournal(task));
    const inBoard = tasks.has(task) ? '' : '（看板外）';
    if (state.claim) {
      const flag = state.claim.stale ? ' ⚠断线' : '';
      rows.push(`占用 | ${task}${inBoard} | ${state.claim.owner} · 活动 ${fmtAge(state.claim.lastActivity)}${flag} | 断点：${truncate(state.lastCheckpoint?.next) || '⚠ 无'}`);
    } else {
      rows.push(`空闲 | ${task}${inBoard} | 无认领 | 断点：${truncate(state.lastCheckpoint?.next) || '无'}`);
    }
    tasks.delete(task);
  }
  for (const [id, task] of tasks) {
    if (task.status !== 'verified') rows.push(`待办 | ${id} | 无日志 | ${task.label ?? ''}`);
  }
  console.log(`== 任务占用与断点（journal + status-data，生成于 ${new Date().toISOString()}）==`);
  if (status.error) console.log(`⚠ ${status.error}`);
  if (!rows.length) {
    console.log('暂无任务记录。');
    return;
  }
  for (const row of rows) console.log(row);
}

async function cmdCheck() {
  const status = await loadStatus();
  const journals = await listJournals();
  const violations = [];
  const infos = [];
  const activeClaims = [];
  let readFailures = 0;
  for (const task of journals) {
    let state;
    try {
      state = deriveState(await readJournal(task));
    } catch (error) {
      violations.push(`${task}: 台账无法解析 —— ${error.message}`);
      readFailures += 1;
      continue;
    }
    if (!state.claim) continue;
    activeClaims.push({ task, claim: state.claim });
    if (!hasCheckpointSinceClaim(state)) {
      violations.push(`${task}: 认领者 ${state.claim.owner} 认领后从未记录 checkpoint（违反铁律 2）。`);
    }
    if (state.claim.stale) {
      violations.push(`${task}: ${state.claim.owner} 超过 TTL ${state.claim.ttlMinutes} 分钟无活动（${fmtAge(state.claim.lastActivity)}），疑似额度墙断线；确认后他人可直接接管。`);
    }
  }
  const fileOwners = new Map();
  for (const { task, claim } of activeClaims) {
    for (const file of claim.files) {
      const owners = fileOwners.get(file) ?? [];
      owners.push(`${task}/${claim.owner}`);
      fileOwners.set(file, owners);
    }
  }
  for (const [file, owners] of fileOwners) {
    if (owners.length > 1) violations.push(`文件冲突：${file} 被多份活跃认领声明 —— ${owners.join('、')}（违反铁律 1）。`);
  }
  if (status.data) {
    for (const task of status.data.tasks) {
      if (task.status !== 'verified' && !journals.includes(task.id)) {
        infos.push(`看板待办 ${task.id}（${task.label ?? task.status}）尚无台账；接手前先 claim。`);
      }
    }
  } else {
    infos.push(`status-data.js 不可读（${status.error}），跳过看板待办核对。`);
  }
  console.log(`== 台账校验（journal 数 ${journals.length}，活跃认领 ${activeClaims.length}）==`);
  for (const violation of violations) console.log(`✗ ${violation}`);
  for (const info of infos) console.log(`· ${info}`);
  if (!violations.length) console.log('✓ 铁律不变量全部满足。');
  if (violations.length || readFailures) process.exitCode = 1;
}

async function main() {
  const raw = process.argv.slice(2);
  if (!raw.length || raw.includes('--help') || raw.includes('-h') || raw[0] === 'help') {
    console.log(USAGE);
    return;
  }
  const parsed = parseArgs(raw);
  const command = parsed._[0];
  const commands = { status: cmdStatus, brief: cmdBrief, claim: cmdClaim, checkpoint: cmdCheckpoint, note: cmdNote, release: cmdRelease, check: cmdCheck };
  if (!Object.prototype.hasOwnProperty.call(commands, command)) throw new Error(`未知命令 ${command}。见 --help。`);
  await commands[command](parsed);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}

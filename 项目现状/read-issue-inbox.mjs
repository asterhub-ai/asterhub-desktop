#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const directory = path.dirname(fileURLToPath(import.meta.url));
const defaults = {
  inbox: path.join(directory, '问题提交记录.jsonl'),
  status: path.join(directory, 'status-data.js'),
};

function parseArgs(args) {
  const paths = { ...defaults };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option !== '--inbox' && option !== '--status') {
      throw new Error(`Unknown argument: ${option}. Use --inbox <path> and/or --status <path>.`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing path after ${option}.`);
    paths[option === '--inbox' ? 'inbox' : 'status'] = path.resolve(value);
    index += 1;
  }
  return paths;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

async function readInbox(file) {
  let source;
  try {
    source = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error(`Cannot read inbox ${file}: ${error.message}`);
  }

  const byId = new Map();
  const problems = [];
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (!raw.trim()) continue;
    let record;
    try {
      record = JSON.parse(raw);
    } catch (error) {
      problems.push(`line ${index + 1}: malformed JSON (${error.message})`);
      continue;
    }
    if (!record || Array.isArray(record) || typeof record !== 'object'
      || record.schemaVersion !== 1
      || typeof record.id !== 'string' || !/^ISSUE-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.id)
      || typeof record.submittedAt !== 'string'
      || typeof record.title !== 'string' || !record.title.trim()
      || typeof record.actual !== 'string' || !record.actual.trim()
      || ['steps', 'expected', 'notes'].some((key) => typeof record[key] !== 'string')) {
      problems.push(`line ${index + 1}: record violates schemaVersion 1 issue contract`);
      continue;
    }
    const existing = byId.get(record.id);
    if (existing) {
      if (JSON.stringify(stable(existing.record)) !== JSON.stringify(stable(record))) {
        problems.push(`line ${index + 1}: conflicting duplicate ID ${record.id} (first seen on line ${existing.line})`);
      }
      continue;
    }
    byId.set(record.id, { record, line: index + 1 });
  }
  if (problems.length) throw new Error(`Inbox validation failed:\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
  return [...byId.values()].map(({ record }) => record);
}

async function readTriagedInfo(file) {
  let source;
  try {
    source = await readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read status data ${file}: ${error.message}`);
  }
  const sandbox = { window: {} };
  try {
    vm.runInNewContext(source, sandbox, { filename: file, timeout: 1000 });
  } catch (error) {
    throw new Error(`Cannot evaluate status data ${file}: ${error.message}`);
  }
  const status = sandbox.window.ASTERHUB_STATUS;
  const tasks = status?.tasks;
  if (!Array.isArray(tasks)) throw new Error(`Status data ${file} has no ASTERHUB_STATUS.tasks array.`);
  const triagedIds = new Set();
  const triageDetails = new Map();
  for (const [index, task] of tasks.entries()) {
    if (!task || typeof task !== 'object') throw new Error(`Status task ${index + 1} is not an object.`);
    if (task.submissionIds === undefined) continue;
    if (!Array.isArray(task.submissionIds) || task.submissionIds.some((id) => typeof id !== 'string')) {
      throw new Error(`Status task ${task.id ?? index + 1} has invalid submissionIds.`);
    }
    for (const id of task.submissionIds) {
      triagedIds.add(id);
      triageDetails.set(id, { kind: 'product_task', taskId: task.id });
    }
  }
  const inboxTriage = status.handoff?.inbox?.triage ?? status.auxiliaryTriage;
  if (Array.isArray(inboxTriage)) {
    for (const entry of inboxTriage) {
      if (entry && typeof entry.id === 'string' && entry.status) {
        triagedIds.add(entry.id);
        if (!triageDetails.has(entry.id)) {
          triageDetails.set(entry.id, {
            kind: 'auxiliary',
            taskId: entry.taskId ?? null,
            status: entry.status,
            note: entry.note ?? '',
          });
        }
      }
    }
  }
  return { triagedIds, triageDetails };
}

try {
  const paths = parseArgs(process.argv.slice(2));
  const [records, { triagedIds, triageDetails }] = await Promise.all([
    readInbox(paths.inbox),
    readTriagedInfo(paths.status),
  ]);
  const pending = records.filter((record) => !triagedIds.has(record.id));
  const productTriaged = records.filter((record) => triageDetails.get(record.id)?.kind === 'product_task');
  const auxiliaryTriaged = records.filter((record) => triageDetails.get(record.id)?.kind === 'auxiliary');
  process.stdout.write(`${JSON.stringify({
    inbox: paths.inbox,
    recordCount: records.length,
    pendingCount: pending.length,
    triagedCount: records.length - pending.length,
    productLinkedCount: productTriaged.length,
    auxiliaryCount: auxiliaryTriaged.length,
    pending,
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}

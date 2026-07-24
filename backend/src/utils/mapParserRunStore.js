import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const storeFile = fileURLToPath(new URL('../../../data/map-parser-runs.json', import.meta.url));
const emptyProgress = { current: 0, total: 0, matched: 0, checked: 0, target: 0 };
let writeQueue = Promise.resolve();
let persistTimer = null;

async function loadRuns() {
  try {
    const parsed = JSON.parse(await readFile(storeFile, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const runs = await loadRuns();
for (const run of Object.values(runs)) {
  run.isRunning = false;
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const content = JSON.stringify(runs, null, 2);
    writeQueue = writeQueue.catch(() => {}).then(async () => {
      await mkdir(dirname(storeFile), { recursive: true });
      await writeFile(storeFile, content, 'utf8');
    });
  }, 150);
}

function ensureRun(platform) {
  runs[platform] ||= {
    isRunning: false,
    query: '',
    targetCount: 0,
    filters: {},
    leads: [],
    progress: { ...emptyProgress },
    startedAt: '',
    finishedAt: '',
  };
  return runs[platform];
}

export function startMapParserRun(platform, { query = '', targetCount = 0, filters = {} } = {}) {
  runs[platform] = {
    isRunning: true,
    query,
    targetCount,
    filters,
    leads: [],
    progress: { ...emptyProgress, target: targetCount },
    startedAt: new Date().toISOString(),
    finishedAt: '',
  };
  schedulePersist();
}

export function recordMapParserLead(platform, lead) {
  const run = ensureRun(platform);
  if (!run.leads.some((item) => item.sourceUrl === lead.sourceUrl)) {
    run.leads.unshift(lead);
  }
  run.progress.matched = run.leads.length;
  schedulePersist();
}

export function recordMapParserProgress(platform, progress) {
  const run = ensureRun(platform);
  run.progress = {
    current: Number(progress.currentPage) || 0,
    total: Number(progress.totalPages) || 0,
    matched: Number(progress.matchedCount) || run.leads.length,
    checked: Number(progress.candidatesChecked) || 0,
    target: Number(progress.targetCount) || run.targetCount,
  };
  schedulePersist();
}

export function recordMapParserContacted(platform, sourceUrl, contactedAt) {
  const run = ensureRun(platform);
  const lead = run.leads.find((item) => item.sourceUrl === sourceUrl);
  if (!lead) return;
  if (contactedAt) lead.contactedAt = contactedAt;
  else delete lead.contactedAt;
  schedulePersist();
}

export function finishMapParserRun(platform) {
  const run = ensureRun(platform);
  run.isRunning = false;
  run.finishedAt = new Date().toISOString();
  schedulePersist();
}

export function getMapParserRun(platform, isRunning = false) {
  const run = ensureRun(platform);
  return structuredClone({ ...run, isRunning });
}

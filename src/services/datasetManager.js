import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import cron from 'node-cron';
import pino from 'pino';
import { fetchAllDatasets } from './steelTigerClient.js';

const logger = pino();

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

export function getDataDir() {
  return dataDir;
}

function datasetFile(datasetKey) {
  return path.join(dataDir, `${datasetKey}.json`);
}

export async function refreshAllDatasets() {
  ensureDir(dataDir);
  const datasets = await fetchAllDatasets();
  await Promise.all(
    Object.entries(datasets).map(async ([key, value]) => {
      const file = datasetFile(key);
      const content = JSON.stringify(value, null, 2);
      await fsp.writeFile(file, content, 'utf8');
    })
  );
  return datasets;
}

export async function scheduleRefresh() {
  ensureDir(dataDir);
  const cronExpr = process.env.REFRESH_CRON || '5 * * * *';
  try {
    // Initial refresh on boot
    await refreshAllDatasets();
    logger.info(`Initial datasets refreshed. Scheduling cron: ${cronExpr}`);
  } catch (err) {
    logger.error({ err }, 'Initial refresh failed');
  }
  cron.schedule(cronExpr, async () => {
    try {
      logger.info('Cron: refreshing datasets');
      await refreshAllDatasets();
      logger.info('Cron: datasets refreshed successfully');
    } catch (err) {
      logger.error({ err }, 'Cron refresh failed');
    }
  });
}

function readDatasetSync(datasetKey) {
  const file = datasetFile(datasetKey);
  if (!fs.existsSync(file)) return { meta: { dataset: datasetKey, count: 0 }, data: [] };
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const json = JSON.parse(raw);
    if (!json || !Array.isArray(json.data)) return { meta: { dataset: datasetKey, count: 0 }, data: [] };
    return json;
  } catch {
    return { meta: { dataset: datasetKey, count: 0 }, data: [] };
  }
}

export function getAvailableDatasets() {
  ensureDir(dataDir);
  const files = fs.readdirSync(dataDir).filter((f) => f.endsWith('.json'));
  return files.map((f) => path.basename(f, '.json'));
}

export function getDataset(datasetKey, opts = {}) {
  const { q, limit, fields } = opts;
  const json = readDatasetSync(datasetKey);
  let rows = Array.isArray(json.data) ? json.data : [];
  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter((row) =>
      Object.entries(row).some(([k, v]) =>
        (!fields || fields.includes(k)) && typeof v !== 'object' && String(v).toLowerCase().includes(needle)
      )
    );
  }
  if (fields && fields.length > 0) {
    rows = rows.map((row) => {
      const out = {};
      for (const f of fields) out[f] = row[f];
      return out;
    });
  }
  const limited = typeof limit === 'number' && limit > 0 ? rows.slice(0, limit) : rows;
  return { meta: json.meta, count: limited.length, data: limited };
}

export function searchDatasets(query, opts = {}) {
  const { datasets, fields, limit } = opts;
  const targets = datasets && datasets.length > 0 ? datasets : getAvailableDatasets();
  const results = [];
  for (const ds of targets) {
    const res = getDataset(ds, { q: query, fields, limit });
    for (const row of res.data) results.push({ dataset: ds, row });
  }
  const limited = typeof limit === 'number' && limit > 0 ? results.slice(0, limit) : results;
  return { query, count: limited.length, results: limited };
}

export function joinDatasets(left, right, opts = {}) {
  const { leftKey, rightKey, limit } = opts;
  const leftJson = readDatasetSync(left);
  const rightJson = readDatasetSync(right);
  const leftRows = Array.isArray(leftJson.data) ? leftJson.data : [];
  const rightRows = Array.isArray(rightJson.data) ? rightJson.data : [];
  const lk = leftKey || inferJoinKey(leftRows);
  const rk = rightKey || inferJoinKey(rightRows);
  if (!lk || !rk) return { error: 'Unable to infer join keys. Provide leftKey and rightKey.' };

  const rightIndex = new Map();
  for (const rr of rightRows) {
    const key = rr[rk];
    if (key === undefined || key === null) continue;
    if (!rightIndex.has(key)) rightIndex.set(key, []);
    rightIndex.get(key).push(rr);
  }

  const joined = [];
  for (const lr of leftRows) {
    const key = lr[lk];
    if (key === undefined || key === null) continue;
    const matches = rightIndex.get(key) || [];
    for (const mr of matches) joined.push({ key, left: lr, right: mr });
  }

  const limited = typeof limit === 'number' && limit > 0 ? joined.slice(0, limit) : joined;
  return { left, right, leftKey: lk, rightKey: rk, count: limited.length, rows: limited };
}

function inferJoinKey(rows) {
  if (!rows || rows.length === 0) return undefined;
  const sample = rows[0];
  if (sample.CODIGO !== undefined) return 'CODIGO';
  if (sample.COD_ALFABA !== undefined) return 'COD_ALFABA';
  return Object.keys(sample)[0];
}



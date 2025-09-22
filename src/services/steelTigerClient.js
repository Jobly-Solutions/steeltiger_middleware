import { fetch } from 'undici';

const STEEL_API_URL = process.env.STEEL_API_URL || 'https://www.apiarbro.xfoxnet.com/api/RecuperarDatos_ERP_por_Query';
const STEEL_AUTH_URL = 'https://www.apiarbro.xfoxnet.com/Api/Autorizacion';

const STEEL_CREDENTIALS = {
  _licencia: process.env.STEEL_LICENSE || '',
  _usuario: process.env.STEEL_USER || '',
  _password: process.env.STEEL_PASSWORD || '',
  _cuit: process.env.STEEL_CUIT || '0',
  _parametros: null,
  jsonPuro: true
};

export const DATASET_QUERIES = {
  clientes: 'Clientes',
  productos: 'Productos',
  lista_precios: 'ListaDePrecios'
};

async function postJson(url, body, attempt = 1) {
  const maxAttempts = 4;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return await res.json();
  } catch (err) {
    if (attempt < maxAttempts) {
      const delayMs = Math.min(1000 * Math.pow(2, attempt), 8000);
      await new Promise((r) => setTimeout(r, delayMs));
      return postJson(url, body, attempt + 1);
    }
    throw err;
  }
}

export async function fetchDataset(datasetKey) {
  const queryName = DATASET_QUERIES[datasetKey];
  if (!queryName) throw new Error(`Unknown dataset: ${datasetKey}`);
  const payload = { ...STEEL_CREDENTIALS, _query: queryName };
  const json = await postJson(STEEL_API_URL, payload);
  const datos = json?.Datos || [];
  return {
    meta: {
      dataset: datasetKey,
      query: queryName,
      count: Array.isArray(datos) ? datos.length : 0,
      fetchedAt: new Date().toISOString()
    },
    data: Array.isArray(datos) ? datos : []
  };
}

export async function fetchAllDatasets() {
  const keys = Object.keys(DATASET_QUERIES);
  const results = await Promise.all(keys.map((k) => fetchDataset(k).then((r) => [k, r])));
  return Object.fromEntries(results);
}

export async function authorizeSteel(email) {
  const license = process.env.STEEL_LICENSE || '';
  const finalEmail = email || process.env.STEEL_EMAIL || '';
  if (!license || !finalEmail) {
    return { ok: false, error: 'Missing STEEL_LICENSE or email' };
  }
  const body = { _licencia: license, _email: finalEmail };
  const res = await fetch(STEEL_AUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, response: json };
}



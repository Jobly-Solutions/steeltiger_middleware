import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import pino from 'pino';
import pretty from 'pino-pretty';
import { scheduleRefresh, getAvailableDatasets, getDataset, refreshAllDatasets, searchDatasets, joinDatasets, getDataDir, syncClientDataToBravilo } from './services/datasetManager.js';
import { fetchDataset, authorizeSteel } from './services/steelTigerClient.js';
import { answerQuestion } from './services/ai.js';
import { syncContactsToBravilo, getContactsFromDataset, getBestPriceForClient } from './services/braviloClient.js';

const envPort = process.env.PORT ? Number(process.env.PORT) : 3008;
const app = express();
const httpServer = createServer(app);

const logger = pino(
  process.env.NODE_ENV === 'development'
    ? pretty({ colorize: true })
    : undefined
);

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'steel-tiger-middleware', dataDir: getDataDir(), datasets: getAvailableDatasets() });
});

app.get('/datasets', (_req, res) => {
  res.json({ datasets: getAvailableDatasets() });
});

app.get('/data/:dataset', (req, res) => {
  const { dataset } = req.params;
  const { q, limit, fields } = req.query;
  const result = getDataset(String(dataset), {
    q: typeof q === 'string' ? q : undefined,
    limit: typeof limit === 'string' ? Number(limit) : undefined,
    fields: typeof fields === 'string' ? fields.split(',').map((s) => s.trim()).filter(Boolean) : undefined
  });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.get('/search', (req, res) => {
  const { query, dataset, fields, limit } = req.query;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Missing query' });
  }
  const datasets = dataset && typeof dataset === 'string' ? dataset.split(',').map((s) => s.trim()) : undefined;
  const fieldList = fields && typeof fields === 'string' ? fields.split(',').map((s) => s.trim()) : undefined;
  const max = typeof limit === 'string' ? Number(limit) : undefined;
  const result = searchDatasets(query, { datasets, fields: fieldList, limit: max });
  res.json(result);
});

app.get('/join', (req, res) => {
  const { left, right, leftKey, rightKey, limit } = req.query;
  if (!left || !right) {
    return res.status(400).json({ error: 'left and right datasets are required' });
  }
  const result = joinDatasets(String(left), String(right), {
    leftKey: typeof leftKey === 'string' ? leftKey : undefined,
    rightKey: typeof rightKey === 'string' ? rightKey : undefined,
    limit: typeof limit === 'string' ? Number(limit) : undefined
  });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.post('/refresh', async (_req, res) => {
  try {
    // Try authorization before refresh (best-effort)
    if (process.env.STEEL_LICENSE && (process.env.STEEL_EMAIL || process.env.STEEL_USER)) {
      await authorizeSteel(process.env.STEEL_EMAIL || process.env.STEEL_USER).catch(() => {});
    }
    const data = await refreshAllDatasets();
    res.json({ ok: true, refreshedAt: new Date().toISOString(), datasets: Object.keys(data) });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Refresh failed' });
  }
});

// Endpoint to fetch client data from Steel Tiger API
app.get('/clients', async (req, res) => {
  try {
    const { dataset = 'clientes_ia' } = req.query;
    const data = await fetchDataset(dataset);
    res.json({
      success: true,
      meta: data.meta,
      count: data.data.length,
      data: data.data
    });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch client data',
      message: err.message 
    });
  }
});

// Endpoint to sync contacts to Bravilo AI
app.post('/sync/contacts', async (req, res) => {
  try {
    const { dataset = 'clientes_ia' } = req.body;
    
    // First try to get contacts from local dataset
    let contacts = getContactsFromDataset({ getDataset }, dataset);
    
    // If no local data, fetch directly from Steel Tiger
    if (contacts.length === 0) {
      logger.info(`No local data found for ${dataset}, fetching from Steel Tiger...`);
      const data = await fetchDataset(dataset);
      contacts = data.data || [];
    }
    
    if (contacts.length === 0) {
      return res.json({
        success: true,
        message: 'No contacts found to sync',
        synced: 0
      });
    }

    const result = await syncContactsToBravilo(contacts);
    res.json({
      success: result.success,
      synced: result.synced,
      errors: result.errors,
      message: result.success 
        ? `Successfully synced ${result.synced} contacts to Bravilo AI`
        : 'Failed to sync contacts to Bravilo AI'
    });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to sync contacts',
      message: err.message 
    });
  }
});

// Endpoint to manually trigger client data refresh and sync
app.post('/sync/clients', async (req, res) => {
  try {
    // First refresh the client data
    const data = await fetchDataset('clientes_ia');
    
    // Then sync to Bravilo AI
    const contacts = data.data || [];
    const syncResult = await syncContactsToBravilo(contacts);
    
    res.json({
      success: syncResult.success,
      refreshed: data.data.length,
      synced: syncResult.synced,
      errors: syncResult.errors,
      message: `Refreshed ${data.data.length} clients and synced ${syncResult.synced} contacts`
    });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to refresh and sync client data',
      message: err.message 
    });
  }
});

// Endpoint to manually trigger client sync to Bravilo AI (using cached data)
app.post('/sync/clients-to-bravilo', async (req, res) => {
  try {
    const result = await syncClientDataToBravilo();
    res.json({
      success: result.success,
      synced: result.synced,
      errors: result.errors,
      message: result.success 
        ? `Successfully synced ${result.synced} contacts to Bravilo AI`
        : 'Failed to sync contacts to Bravilo AI'
    });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to sync client data to Bravilo AI',
      message: err.message 
    });
  }
});

// Diagnostic endpoint to check authorization and data status
app.get('/diagnostic', async (req, res) => {
  try {
    const results = {};
    
    // Check Steel Tiger authorization
    try {
      const authResult = await authorizeSteel(process.env.STEEL_EMAIL || process.env.STEEL_USER);
      results.authorization = {
        success: authResult.ok,
        status: authResult.status,
        message: authResult.response?.Respuesta || 'Authorization check completed'
      };
    } catch (err) {
      results.authorization = {
        success: false,
        error: err.message
      };
    }
    
    // Check data availability for different datasets
    const datasets = ['clientes', 'clientes_ia', 'productos', 'lista_precios'];
    results.datasets = {};
    
    for (const dataset of datasets) {
      try {
        const data = await fetchDataset(dataset);
        results.datasets[dataset] = {
          success: true,
          count: data.data?.length || 0,
          hasData: (data.data?.length || 0) > 0,
          lastFetched: data.meta?.fetchedAt
        };
      } catch (err) {
        results.datasets[dataset] = {
          success: false,
          error: err.message
        };
      }
    }
    
    // Check Bravilo AI token
    results.bravilo = {
      tokenConfigured: !!process.env.BRAVILO_TOKEN,
      tokenLength: process.env.BRAVILO_TOKEN?.length || 0
    };
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...results
    });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ 
      success: false, 
      error: 'Diagnostic failed',
      message: err.message 
    });
  }
});

app.post('/ai/query', async (req, res) => {
  try {
    let { question, datasets, filters, limit } = req.body || {};
    
    // Handle Bravilo's nested JSON structure
    if (req.body && req.body.body && req.body.body.body) {
      const nestedBody = req.body.body.body;
      question = nestedBody.question;
      datasets = nestedBody.datasets;
      limit = nestedBody.limit;
      filters = nestedBody.filters;
    }
    
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'question is required' });
    }
    
    // Handle datasets as string or array
    let processedDatasets = datasets;
    if (typeof datasets === 'string') {
      try {
        processedDatasets = JSON.parse(datasets);
      } catch (e) {
        // If it's not valid JSON, treat as comma-separated string
        processedDatasets = datasets.split(',').map(s => s.trim().replace(/['"]/g, ''));
      }
    }
    
    // Handle limit as string or number
    let processedLimit = limit;
    if (typeof limit === 'string') {
      processedLimit = parseInt(limit, 10) || undefined;
    }
    
    const answer = await answerQuestion({ 
      question, 
      datasets: processedDatasets, 
      filters, 
      limit: processedLimit 
    });
    res.json(answer);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'AI query failed' });
  }
});

// Endpoint para consultar precios por teléfono del cliente
app.post('/price/by-phone', async (req, res) => {
  try {
    const { _phoneNumber, productCode } = req.body || {};
    
    if (!_phoneNumber) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing _phoneNumber parameter' 
      });
    }
    
    if (!productCode) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing productCode parameter' 
      });
    }
    
    const result = getBestPriceForClient(productCode, _phoneNumber, { getDataset });
    
    if (result.found) {
      res.json({
        success: true,
        productCode,
        phoneNumber: _phoneNumber,
        client: result.client,
        clientList: result.clientList,
        price: result.price,
        priceDetails: result.priceDetails,
        message: `Precio encontrado para ${result.client.nombre} (Lista: ${result.clientList})`
      });
    } else {
      res.json({
        success: false,
        productCode,
        phoneNumber: _phoneNumber,
        error: result.error,
        clientList: result.clientList,
        message: result.error
      });
    }
  } catch (err) {
    logger.error({ err, body: req.body }, 'Price by phone query failed');
    res.status(500).json({ 
      success: false, 
      error: 'Price query failed',
      message: err.message 
    });
  }
});

// Debug: consultar directamente Steel Tiger para un _query dado
app.get('/debug/steel', async (req, res) => {
  try {
    const q = typeof req.query.query === 'string' ? req.query.query : undefined;
    if (!q) return res.status(400).json({ error: 'query param required (e.g., Productos, Clientes, ClientesIA, ListaDePrecios)' });
    const map = { 
      Productos: 'productos', 
      Clientes: 'clientes', 
      ClientesIA: 'clientes_ia',
      ListaDePrecios: 'lista_precios' 
    };
    const datasetKey = map[q] || null;
    if (!datasetKey) return res.status(400).json({ error: 'Unsupported query' });
    const data = await fetchDataset(datasetKey);
    res.json({ ok: true, meta: data.meta, sample: data.data.slice(0, 5) });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Authorization endpoint
app.post('/auth', async (req, res) => {
  try {
    const email = (req.body && req.body.email) || process.env.STEEL_EMAIL || process.env.STEEL_USER;
    const result = await authorizeSteel(email);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// AI Query endpoint with GET support
app.get('/ai/query-simple', async (req, res) => {
  try {
    const { question, datasets, limit } = req.query;
    if (!question) {
      return res.status(400).json({ error: 'question parameter is required' });
    }
    const answer = await answerQuestion({ 
      question, 
      datasets: datasets ? datasets.split(',') : undefined, 
      limit: limit ? Number(limit) : undefined 
    });
    res.json(answer);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'AI query failed' });
  }
});

httpServer.listen(envPort, async () => {
  logger.info(`Steel Tiger middleware listening on http://localhost:${envPort}`);
  await scheduleRefresh();
});



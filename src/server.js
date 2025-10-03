import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import pino from 'pino';
import pretty from 'pino-pretty';
import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
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

// Test UI for AI queries
app.get('/test', (_req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Steel Tiger AI - Test Interface</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    .header {
      text-align: center;
      color: white;
      margin-bottom: 30px;
    }
    .header h1 {
      font-size: 2.5rem;
      margin-bottom: 10px;
    }
    .header p {
      font-size: 1.1rem;
      opacity: 0.9;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 30px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      margin-bottom: 20px;
    }
    .search-box {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
    }
    .search-input {
      flex: 1;
      padding: 15px 20px;
      border: 2px solid #e0e0e0;
      border-radius: 12px;
      font-size: 16px;
      transition: all 0.3s;
    }
    .search-input:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }
    .search-btn {
      padding: 15px 40px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .search-btn:hover {
      transform: translateY(-2px);
    }
    .search-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .options {
      display: flex;
      gap: 20px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .option-group {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .option-group label {
      font-weight: 500;
      color: #333;
    }
    .option-group input[type="number"],
    .option-group input[type="text"] {
      padding: 8px 12px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      width: 150px;
    }
    .examples {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 20px;
    }
    .example-btn {
      padding: 8px 16px;
      background: #f0f0f0;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.2s;
    }
    .example-btn:hover {
      background: #667eea;
      color: white;
      border-color: #667eea;
    }
    .loading {
      text-align: center;
      padding: 40px;
      color: #667eea;
      font-size: 18px;
      display: none;
    }
    .spinner {
      border: 4px solid #f3f3f3;
      border-top: 4px solid #667eea;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .results {
      display: none;
    }
    .result-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 15px;
      border-bottom: 2px solid #e0e0e0;
    }
    .result-header h2 {
      color: #333;
      font-size: 1.5rem;
    }
    .result-stats {
      display: flex;
      gap: 20px;
      font-size: 14px;
      color: #666;
    }
    .stat {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .stat-value {
      font-weight: 600;
      color: #667eea;
    }
    .answer-box {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px;
      border-radius: 12px;
      margin-bottom: 20px;
      font-size: 16px;
      line-height: 1.6;
    }
    .products-grid {
      display: grid;
      gap: 15px;
    }
    .product-card {
      border: 2px solid #e0e0e0;
      border-radius: 12px;
      padding: 20px;
      transition: all 0.3s;
    }
    .product-card:hover {
      border-color: #667eea;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
    }
    .product-header {
      display: flex;
      justify-content: space-between;
      align-items: start;
      margin-bottom: 15px;
    }
    .product-title {
      flex: 1;
      font-weight: 600;
      color: #333;
      font-size: 16px;
      line-height: 1.4;
    }
    .product-price {
      font-size: 24px;
      font-weight: 700;
      color: #667eea;
      margin-left: 20px;
    }
    .product-details {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin-top: 15px;
    }
    .product-detail {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .detail-label {
      font-size: 12px;
      color: #666;
      text-transform: uppercase;
      font-weight: 500;
    }
    .detail-value {
      font-size: 14px;
      color: #333;
      font-weight: 500;
    }
    .sku-badge {
      display: inline-block;
      padding: 4px 12px;
      background: #f0f0f0;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      color: #666;
    }
    .error {
      background: #fee;
      border: 2px solid #fcc;
      color: #c33;
      padding: 20px;
      border-radius: 12px;
      margin-top: 20px;
    }
    .debug-section {
      margin-top: 20px;
      padding: 20px;
      background: #f9f9f9;
      border-radius: 12px;
      border: 2px solid #e0e0e0;
    }
    .debug-section h3 {
      color: #333;
      margin-bottom: 15px;
      font-size: 1.2rem;
    }
    .debug-content {
      background: #fff;
      padding: 15px;
      border-radius: 8px;
      border: 1px solid #e0e0e0;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      max-height: 400px;
      overflow: auto;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔍 Steel Tiger AI Search</h1>
      <p>Interfaz de prueba para consultas en lenguaje natural</p>
    </div>

    <div class="card">
      <div class="search-box">
        <input 
          type="text" 
          class="search-input" 
          id="searchInput" 
          placeholder="Ej: tenes defensas para nissan 19, cuanto sale un enganche amarok, etc..."
          autocomplete="off"
        />
        <button class="search-btn" id="searchBtn">Buscar</button>
      </div>

      <div class="options">
        <div class="option-group">
          <label>Límite:</label>
          <input type="number" id="limitInput" value="10" min="1" max="100" />
        </div>
        <div class="option-group">
          <label>Teléfono (opcional):</label>
          <input type="text" id="phoneInput" placeholder="+54..." />
        </div>
        <div class="option-group">
          <label>Código Producto (opcional):</label>
          <input type="text" id="productCodeInput" placeholder="DBN114" />
        </div>
      </div>

      <div class="examples">
        <strong style="margin-right: 10px;">Ejemplos:</strong>
        <button class="example-btn" data-query="tenes defensas para nissan 19">Defensas Nissan 19</button>
        <button class="example-btn" data-query="cuanto sale enganche amarok">Enganche Amarok</button>
        <button class="example-btn" data-query="lona maritima hilux">Lona Hilux</button>
        <button class="example-btn" data-query="accesorios ranger">Accesorios Ranger</button>
      </div>

      <div class="loading" id="loading">
        <div class="spinner"></div>
        <p>Buscando productos...</p>
      </div>

      <div class="results" id="results">
        <div class="result-header">
          <h2>Resultados</h2>
          <div class="result-stats">
            <div class="stat">
              <span>Encontrados:</span>
              <span class="stat-value" id="resultCount">0</span>
            </div>
            <div class="stat">
              <span>Tiempo:</span>
              <span class="stat-value" id="resultTime">0ms</span>
            </div>
          </div>
        </div>

        <div class="answer-box" id="answerBox"></div>
        
        <div class="products-grid" id="productsGrid"></div>

        <div class="debug-section">
          <h3>🔧 Debug Info</h3>
          <div class="debug-content" id="debugInfo"></div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    const limitInput = document.getElementById('limitInput');
    const phoneInput = document.getElementById('phoneInput');
    const productCodeInput = document.getElementById('productCodeInput');
    const loading = document.getElementById('loading');
    const results = document.getElementById('results');
    const answerBox = document.getElementById('answerBox');
    const productsGrid = document.getElementById('productsGrid');
    const resultCount = document.getElementById('resultCount');
    const resultTime = document.getElementById('resultTime');
    const debugInfo = document.getElementById('debugInfo');

    // Example buttons
    document.querySelectorAll('.example-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        searchInput.value = btn.dataset.query;
        performSearch();
      });
    });

    // Search on Enter
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') performSearch();
    });

    // Search button
    searchBtn.addEventListener('click', performSearch);

    async function performSearch() {
      const question = searchInput.value.trim();
      if (!question) return;

      const limit = parseInt(limitInput.value) || 10;
      const phone = phoneInput.value.trim();
      const productCode = productCodeInput.value.trim();

      loading.style.display = 'block';
      results.style.display = 'none';
      searchBtn.disabled = true;

      const startTime = Date.now();

      try {
        const body = {
          question,
          limit
        };

        if (phone) body._phoneNumber = phone;
        if (productCode) body.productCode = productCode;

        const response = await fetch('/ai/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        const endTime = Date.now();
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Error en la búsqueda');
        }

        displayResults(data, endTime - startTime);
      } catch (error) {
        loading.style.display = 'none';
        results.style.display = 'block';
        productsGrid.innerHTML = \`<div class="error"><strong>Error:</strong> \${error.message}</div>\`;
        debugInfo.textContent = JSON.stringify({ error: error.message, stack: error.stack }, null, 2);
      } finally {
        searchBtn.disabled = false;
      }
    }

    function displayResults(data, timeMs) {
      loading.style.display = 'none';
      results.style.display = 'block';

      // Answer
      answerBox.textContent = data.answer || 'Sin respuesta';

      // Stats
      const matches = data.matches || [];
      resultCount.textContent = matches.length;
      resultTime.textContent = timeMs + 'ms';

      // Products
      if (matches.length > 0) {
        productsGrid.innerHTML = matches.map(product => \`
          <div class="product-card">
            <div class="product-header">
              <div class="product-title">\${product.producto || 'Sin nombre'}</div>
              <div class="product-price">\${product.precio || 'N/D'}</div>
            </div>
            <div class="product-details">
              \${product.sku ? \`<div class="product-detail">
                <span class="detail-label">SKU</span>
                <span class="sku-badge">\${product.sku}</span>
              </div>\` : ''}
              \${product.marca ? \`<div class="product-detail">
                <span class="detail-label">Marca</span>
                <span class="detail-value">\${product.marca}</span>
              </div>\` : ''}
              \${product.modelo ? \`<div class="product-detail">
                <span class="detail-label">Modelo</span>
                <span class="detail-value">\${product.modelo}</span>
              </div>\` : ''}
              \${product.listaCategoria ? \`<div class="product-detail">
                <span class="detail-label">Lista</span>
                <span class="detail-value">\${product.listaCategoria}</span>
              </div>\` : ''}
            </div>
          </div>
        \`).join('');
      } else {
        productsGrid.innerHTML = '<div style="text-align: center; padding: 40px; color: #666;">No se encontraron productos</div>';
      }

      // Debug info
      debugInfo.textContent = JSON.stringify(data, null, 2);
    }
  </script>
</body>
</html>
  `);
});

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
    // Log completo de la request
    logger.info({
      body: req.body,
      headers: req.headers,
      query: req.query
    }, 'AI Query Request Received');
    
    let { question, datasets, filters, limit, _phoneNumber, productCode } = req.body || {};
    
    // Handle Bravilo's nested JSON structure
    if (req.body && req.body.body && req.body.body.body) {
      const nestedBody = req.body.body.body;
      question = nestedBody.question;
      datasets = nestedBody.datasets;
      limit = nestedBody.limit;
      filters = nestedBody.filters;
      _phoneNumber = nestedBody._phoneNumber;
      productCode = nestedBody.productCode;
      
      logger.info({
        nestedBody
      }, 'Bravilo Nested Structure Detected');
    }
    
    // Log de parámetros extraídos
    logger.info({
      question,
      datasets,
      limit,
      filters,
      _phoneNumber,
      productCode
    }, 'AI Query Extracted Parameters');
    
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
      limit: processedLimit,
      _phoneNumber,
      productCode
    });
    res.json(answer);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'AI query failed' });
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

// Download all datasets as ZIP
app.get('/download/all', async (req, res) => {
  try {
    const format = req.query.format || 'zip'; // 'zip' or 'json'
    const datasets = getAvailableDatasets();
    const dataDir = getDataDir();
    
    if (format === 'json') {
      // Return all datasets in a single JSON object
      const allData = {};
      for (const ds of datasets) {
        const dsData = getDataset(ds);
        allData[ds] = dsData;
      }
      
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="steel-tiger-all-datasets-${Date.now()}.json"`);
      res.json(allData);
    } else {
      // Create a ZIP file with all datasets
      const archive = archiver('zip', { zlib: { level: 9 } });
      
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="steel-tiger-datasets-${Date.now()}.zip"`);
      
      archive.on('error', (err) => {
        logger.error({ err }, 'Archive error');
        res.status(500).json({ error: 'Failed to create archive' });
      });
      
      // Pipe archive data to the response
      archive.pipe(res);
      
      // Add each dataset JSON file to the archive
      for (const ds of datasets) {
        const filePath = path.join(dataDir, `${ds}.json`);
        if (fs.existsSync(filePath)) {
          archive.file(filePath, { name: `${ds}.json` });
        }
      }
      
      // Add a metadata file with export info
      const metadata = {
        exportedAt: new Date().toISOString(),
        datasets: datasets,
        counts: {}
      };
      
      for (const ds of datasets) {
        const dsData = getDataset(ds);
        metadata.counts[ds] = Array.isArray(dsData.data) ? dsData.data.length : 0;
      }
      
      archive.append(JSON.stringify(metadata, null, 2), { name: 'metadata.json' });
      
      // Finalize the archive
      await archive.finalize();
      
      logger.info({ datasets, format }, 'Datasets downloaded');
    }
  } catch (err) {
    logger.error({ err }, 'Failed to download datasets');
    res.status(500).json({ error: 'Failed to download datasets' });
  }
});

// Download individual dataset
app.get('/download/:dataset', (req, res) => {
  try {
    const { dataset } = req.params;
    const dsData = getDataset(dataset);
    
    if (!dsData || dsData.error) {
      return res.status(404).json({ error: `Dataset ${dataset} not found` });
    }
    
    const filename = `steel-tiger-${dataset}-${Date.now()}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(dsData);
    
    logger.info({ dataset }, 'Dataset downloaded');
  } catch (err) {
    logger.error({ err }, 'Failed to download dataset');
    res.status(500).json({ error: 'Failed to download dataset' });
  }
});

// Download productos with prices (joined data)
app.get('/download/productos-con-precios', (req, res) => {
  try {
    const productos = getDataset('productos');
    const precios = getDataset('lista_precios');
    
    if (!productos || productos.error) {
      return res.status(404).json({ error: 'Productos dataset not found' });
    }
    if (!precios || precios.error) {
      return res.status(404).json({ error: 'Lista_precios dataset not found' });
    }
    
    const productosData = productos.data || [];
    const preciosData = precios.data || [];
    
    // Crear índice de precios por COD_ALFABA
    const preciosPorCodigo = new Map();
    for (const precio of preciosData) {
      const codigo = String(precio.COD_ALFABA || '').trim().toUpperCase();
      if (!codigo) continue;
      
      if (!preciosPorCodigo.has(codigo)) {
        preciosPorCodigo.set(codigo, []);
      }
      preciosPorCodigo.get(codigo).push({
        lista: precio.CATEGORIA || precio.LISTA || null,
        precioNeto: precio.PRE_NETO || null,
        precioBruto: precio.PRE_BRUTO || null,
        rubro: precio.RUBRO || null,
        subrubro: precio.SUBRUBRO || null,
        detalle: precio.DETALLE || null,
        marca: precio.MARCA || null
      });
    }
    
    // Combinar productos con sus precios
    const productosConPrecios = productosData.map(prod => {
      const codigo = String(prod.COD_ALFABA || '').trim().toUpperCase();
      const preciosProducto = preciosPorCodigo.get(codigo) || [];
      
      return {
        codigo: prod.COD_ALFABA || null,
        detalle: prod.DETALLE1 || null,
        marca: prod.MARCA || null,
        modelo: prod.MODELO || null,
        categoria: prod.CATEGORIA || null,
        precios: preciosProducto,
        cantidadListas: preciosProducto.length,
        // Incluir precio mínimo y máximo para referencia rápida
        precioMin: preciosProducto.length > 0 
          ? Math.min(...preciosProducto.map(p => p.precioNeto || p.precioBruto || Infinity).filter(p => p !== Infinity))
          : null,
        precioMax: preciosProducto.length > 0
          ? Math.max(...preciosProducto.map(p => p.precioNeto || p.precioBruto || -Infinity).filter(p => p !== -Infinity))
          : null
      };
    });
    
    const resultado = {
      meta: {
        exportedAt: new Date().toISOString(),
        totalProductos: productosConPrecios.length,
        productosConPrecio: productosConPrecios.filter(p => p.cantidadListas > 0).length,
        productosSinPrecio: productosConPrecios.filter(p => p.cantidadListas === 0).length,
        totalRegistrosPrecios: preciosData.length
      },
      data: productosConPrecios
    };
    
    const filename = `steel-tiger-productos-precios-${Date.now()}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(resultado);
    
    logger.info({ 
      totalProductos: productosConPrecios.length,
      conPrecio: resultado.meta.productosConPrecio,
      sinPrecio: resultado.meta.productosSinPrecio
    }, 'Productos con precios downloaded');
  } catch (err) {
    logger.error({ err }, 'Failed to download productos con precios');
    res.status(500).json({ error: 'Failed to download productos con precios' });
  }
});

httpServer.listen(envPort, async () => {
  logger.info(`Steel Tiger middleware listening on http://localhost:${envPort}`);
  await scheduleRefresh();
});



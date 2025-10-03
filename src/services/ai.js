import OpenAI from 'openai';
import { getAvailableDatasets, getDataset, refreshAllDatasets } from './datasetManager.js';
import { fetchDataset as fetchSteelDataset } from './steelTigerClient.js';
import { getBestPriceForClient } from './braviloClient.js';
import Fuse from 'fuse.js';
import pino from 'pino';

const logger = pino();
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

function normalizeText(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function extractCandidateSku(question) {
  const m = String(question).match(/[A-Z]{2,}[A-Z0-9.-]{2,}/i);
  return m ? m[0].toUpperCase() : null;
}

async function extractIntentWithAI(question) {
  // No usar IA, hacer búsqueda directa y exhaustiva
  const words = question.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  return { 
    intent: 'price_lookup', 
    keywords: words, 
    sku: extractCandidateSku(question) 
  };
}

function rankProducts(products, tokens, sku) {
  const normTokens = tokens.map(normalizeText).filter(Boolean);
  
  // Fuzzy: usar Fuse sobre TODOS los campos relevantes
  const fuse = new Fuse(products, {
    keys: [
      { name: 'DETALLE1', weight: 0.5 },      // Productos
      { name: 'DETALLE', weight: 0.5 },       // Precios
      { name: 'MARCA', weight: 0.2 },
      { name: 'MODELO', weight: 0.2 },
      { name: 'CATEGORIA', weight: 0.15 },    // Ambos
      { name: 'RUBRO', weight: 0.1 },         // Precios
      { name: 'SUBRUBRO', weight: 0.1 },      // Precios
      { name: 'COD_ALFABA', weight: 0.1 }     // Ambos
    ],
    includeScore: true,
    threshold: 0.9, // MUY PERMISIVO - traer todos los resultados posibles
    ignoreLocation: true,
    distance: 1000, // Permitir coincidencias muy lejanas
    minMatchCharLength: 2, // Mínimo 2 caracteres
    shouldSort: true,
    findAllMatches: true // IMPORTANTE: Encuentra TODAS las coincidencias
  });
  
  const query = normTokens.join(' ');
  let results = query ? fuse.search(query).map((r) => ({ row: r.item, score: 1 - (r.score ?? 0) })) : [];
  
  // boost por SKU exacto
  if (sku) {
    results = results.map((r) => ({
      row: r.row,
      score: r.score + (String(r.row.COD_ALFABA || '').toUpperCase() === sku ? 2.0 : 0)
    }));
  }
  
  // fallback más exhaustivo: buscar en TODOS los campos
  if (results.length === 0 && normTokens.length) {
    logger.info('Using exhaustive fallback search (Fuse found nothing)');
    results = products.map((row) => {
      const searchText = normalizeText([
        row.DETALLE1 || '',
        row.DETALLE || '',
        row.MARCA || '',
        row.MODELO || '',
        row.CATEGORIA || '',
        row.RUBRO || '',
        row.SUBRUBRO || '',
        row.COD_ALFABA || ''
      ].join(' '));
      
      let score = 0;
      for (const t of normTokens) {
        if (t && searchText.includes(t)) score += 1;
      }
      if (sku && String(row.COD_ALFABA || '').toUpperCase() === sku) score += 5;
      return { row, score };
    }).filter((x) => x.score > 0);
    
    logger.info({ exhaustiveResultsCount: results.length }, 'Exhaustive search results');
  }
  
  const sortedResults = results.sort((a, b) => b.score - a.score).map((x) => x.row);
  logger.info({ totalResultsReturned: sortedResults.length }, 'rankProducts final count');
  return sortedResults;
}

function buildPriceIndex(priceRows) {
  const map = new Map();
  for (const r of priceRows || []) {
    const key = String(r.COD_ALFABA || '').trim().toUpperCase();
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return map;
}

function formatCurrency(value) {
  if (typeof value !== 'number') return String(value);
  try {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

function rankPriceRows(priceRows, tokens, sku) {
  const normTokens = tokens.map(normalizeText).filter(Boolean);
  const fuse = new Fuse(priceRows, {
    keys: [
      { name: 'DETALLE', weight: 0.5 },
      { name: 'DETALLE1', weight: 0.5 },
      { name: 'RUBRO', weight: 0.15 },
      { name: 'SUBRUBRO', weight: 0.15 },
      { name: 'COD_ALFABA', weight: 0.1 },
      { name: 'CATEGORIA', weight: 0.1 }
    ],
    includeScore: true,
    threshold: 0.9, // MUY PERMISIVO
    ignoreLocation: true,
    distance: 1000,
    minMatchCharLength: 2,
    shouldSort: true,
    findAllMatches: true
  });
  const query = normTokens.join(' ');
  let results = query ? fuse.search(query).map((r) => ({ row: r.item, score: 1 - (r.score ?? 0) })) : [];
  
  if (sku) {
    results = results.map((r) => ({
      row: r.row,
      score: r.score + (String(r.row.COD_ALFABA || '').toUpperCase() === sku ? 2.0 : 0)
    }));
  }
  
  if (results.length === 0 && normTokens.length) {
    logger.info('Using exhaustive fallback for prices (Fuse found nothing)');
    results = priceRows.map((row) => {
      const searchText = normalizeText([
        row.DETALLE || '',
        row.DETALLE1 || '',
        row.RUBRO || '',
        row.SUBRUBRO || '',
        row.COD_ALFABA || '',
        row.CATEGORIA || ''
      ].join(' '));
      
      let score = 0;
      for (const t of normTokens) {
        if (t && searchText.includes(t)) score += 1;
      }
      if (sku && String(row.COD_ALFABA || '').toUpperCase() === sku) score += 5;
      return { row, score };
    }).filter((x) => x.score > 0);
    
    logger.info({ exhaustivePriceResultsCount: results.length }, 'Exhaustive price search results');
  }
  
  const sortedResults = results.sort((a, b) => b.score - a.score).map((x) => x.row);
  logger.info({ totalPriceResultsReturned: sortedResults.length }, 'rankPriceRows final count');
  return sortedResults;
}

export async function answerQuestion({ question, _phoneNumber, productCode, limit }) {
  // Log de entrada a la función
  logger.info({
    question,
    _phoneNumber,
    productCode,
    limit,
    phoneNumberType: typeof _phoneNumber,
    productCodeType: typeof productCode
  }, 'answerQuestion called');
  
  // Si se proporciona _phoneNumber y productCode, usar consulta específica por teléfono
  if (_phoneNumber && productCode && _phoneNumber !== '_phoneNumber') {
    logger.info({
      _phoneNumber,
      productCode
    }, 'Using phone-based price lookup');
    
    try {
      const result = getBestPriceForClient(productCode, _phoneNumber, { getDataset });
      
      logger.info({
        result
      }, 'Phone-based price lookup result');
      
      if (result.found) {
        const priceFormatted = result.price ? new Intl.NumberFormat('es-AR', { 
          style: 'currency', 
          currency: 'ARS', 
          maximumFractionDigits: 2 
        }).format(result.price) : 'N/D';
        
        return {
          answer: `Precio para ${result.client.nombre} (${result.clientList}): ${priceFormatted}`,
          matches: [{
            producto: productCode,
            sku: productCode,
            cliente: result.client,
            clientList: result.clientList,
            precioNumerico: result.price,
            precio: priceFormatted,
            priceDetails: result.priceDetails
          }]
        };
      } else {
        return {
          answer: result.error || 'No se pudo obtener el precio',
          matches: []
        };
      }
    } catch (error) {
      logger.error({ error }, 'Error in phone-based price lookup');
      return {
        answer: 'Error al consultar precio por teléfono',
        matches: []
      };
    }
  }
  
  logger.info('Using standard AI search (no phone number provided)');

  const intent = await extractIntentWithAI(question);

  const productosRes = getDataset('productos');
  const preciosRes = getDataset('lista_precios');
  let productos = productosRes.data || [];
  let precios = preciosRes.data || [];

  logger.info({
    productosCount: productos.length,
    preciosCount: precios.length
  }, 'Local datasets loaded');

  // Fallback: si no hay datos locales, intentar traer directo de Steel Tiger
  try {
    if ((!Array.isArray(productos) || productos.length === 0)) {
      logger.info('Fetching productos from Steel Tiger (local dataset empty)');
      const remoteProd = await fetchSteelDataset('productos');
      if (Array.isArray(remoteProd?.data) && remoteProd.data.length > 0) {
        productos = remoteProd.data;
        logger.info({ count: productos.length }, 'Productos fetched from Steel Tiger');
      }
    }
    if ((!Array.isArray(precios) || precios.length === 0)) {
      logger.info('Fetching precios from Steel Tiger (local dataset empty)');
      const remotePrices = await fetchSteelDataset('lista_precios');
      if (Array.isArray(remotePrices?.data) && remotePrices.data.length > 0) {
        precios = remotePrices.data;
        logger.info({ count: precios.length }, 'Precios fetched from Steel Tiger');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Error fetching from Steel Tiger');
  }

  const tokens = [];
  if (intent?.keywords?.length) tokens.push(...intent.keywords);
  // fallback para palabras comunes
  const fallbackWords = question.split(/\s+/).filter((w) => w.length >= 3);
  tokens.push(...fallbackWords);

  const sku = intent?.sku || extractCandidateSku(question);
  // Sinónimos básicos
  const synonyms = [
    ['lona maritima', 'cobertor', 'tapa', 'cover'],
    ['amarok', 'vw amarok', 'volkswagen amarok']
  ];
  const expanded = new Set(tokens.map((t) => normalizeText(t)));
  for (const group of synonyms) {
    if (group.some((g) => expanded.has(normalizeText(g)))) {
      for (const g of group) expanded.add(normalizeText(g));
    }
  }
  const expandedTokens = Array.from(expanded);
  
  // NO APLICAR LÍMITE - Traer TODOS los resultados que coincidan
  const maxResults = limit || 999999; // Sin límite efectivo
  
  logger.info({
    tokens: expandedTokens,
    sku,
    maxResults,
    totalProductos: productos.length,
    totalPrecios: precios.length
  }, 'Search parameters');
  
  // Buscar SIN LÍMITE - traer todos los que coincidan
  const allCandidates = rankProducts(productos, expandedTokens, sku);
  const allPriceCandidates = rankPriceRows(precios, expandedTokens, sku);
  
  // Solo aplicar límite si el usuario lo especificó explícitamente
  const candidates = limit ? allCandidates.slice(0, limit) : allCandidates;
  const priceOnlyCandidates = limit ? allPriceCandidates.slice(0, limit) : allPriceCandidates;
  
  const priceIdx = buildPriceIndex(precios);

  logger.info({
    allCandidatesCount: allCandidates.length,
    allPriceCandidatesCount: allPriceCandidates.length,
    candidatesCount: candidates.length,
    priceOnlyCandidatesCount: priceOnlyCandidates.length,
    limitApplied: !!limit
  }, 'Search results - ALL products found');

  const answers = [];
  for (const prod of candidates) {
    const key = String(prod.COD_ALFABA || '').trim().toUpperCase();
    const plist = priceIdx.get(key) || [];
    if (plist.length === 0) continue;
    // Elegimos la primera fila (o la de menor PRE_NETO si hay varias)
    const best = plist.reduce((acc, x) => (acc && acc.PRE_NETO < x.PRE_NETO ? acc : x), null) || plist[0];
    const precio = typeof best.PRE_NETO === 'number' ? best.PRE_NETO : (typeof best.PRE_BRUTO === 'number' ? best.PRE_BRUTO : null);
    answers.push({
      producto: prod.DETALLE1 || '',
      sku: key,
      marca: prod.MARCA || null,
      modelo: prod.MODELO || null,
      precioNumerico: precio,
      precio: precio != null ? formatCurrency(precio) : 'N/D',
      listaCategoria: best.CATEGORIA || null
    });
  }

  logger.info({ answersCount: answers.length }, 'Final answers count');

  // Si no hay match por productos, intentamos directo con lista de precios
  if (answers.length === 0 && priceOnlyCandidates.length > 0) {
    const pr = priceOnlyCandidates[0];
    const key = String(pr.COD_ALFABA || '').trim().toUpperCase();
    const precio = typeof pr.PRE_NETO === 'number' ? pr.PRE_NETO : (typeof pr.PRE_BRUTO === 'number' ? pr.PRE_BRUTO : null);
    // Enriquecer con info de productos si existe
    const prodMatch = productos.find((p) => String(p.COD_ALFABA || '').trim().toUpperCase() === key);
    const name = prodMatch?.DETALLE1 || pr.DETALLE || '';
    const text = `Precio ${key ? `(${key}) ` : ''}${name}: ${precio != null ? formatCurrency(precio) : 'N/D'}`;
    return { answer: text, matches: [{
      producto: name,
      sku: key,
      marca: prodMatch?.MARCA || null,
      modelo: prodMatch?.MODELO || null,
      precioNumerico: precio,
      precio: precio != null ? formatCurrency(precio) : 'N/D',
      listaCategoria: pr.CATEGORIA || null
    }] };
  }

  if (answers.length > 0) {
    // Si hay muchos resultados, devolver resumen con todos los matches
    if (answers.length > 5) {
      const text = `Encontré ${answers.length} productos que coinciden con tu búsqueda. Aquí están los resultados:`;
      return { answer: text, matches: answers };
    }
    const top = answers[0];
    const text = `Precio ${top.sku ? `(${top.sku}) ` : ''}${top.producto}: ${top.precio}`;
    return { answer: text, matches: answers };
  }

  // Fallback: intentar refrescar datasets en vivo y reintentar
  try {
    await refreshAllDatasets();
    const productos2 = getDataset('productos').data || [];
    const precios2 = getDataset('lista_precios').data || [];
    const candidates2 = rankProducts(productos2, tokens, sku).slice(0, 5);
    const priceIdx2 = buildPriceIndex(precios2);
    const answers2 = [];
    for (const prod of candidates2) {
      const key = String(prod.COD_ALFABA || '').trim().toUpperCase();
      const plist = priceIdx2.get(key) || [];
      if (plist.length === 0) continue;
      const best = plist.reduce((acc, x) => (acc && acc.PRE_NETO < x.PRE_NETO ? acc : x), null) || plist[0];
      const precio = typeof best.PRE_NETO === 'number' ? best.PRE_NETO : (typeof best.PRE_BRUTO === 'number' ? best.PRE_BRUTO : null);
      answers2.push({
        producto: prod.DETALLE1 || '',
        sku: key,
        marca: prod.MARCA || null,
        modelo: prod.MODELO || null,
        precioNumerico: precio,
        precio: precio != null ? formatCurrency(precio) : 'N/D',
        listaCategoria: best.CATEGORIA || null
      });
    }
    if (answers2.length > 0) {
      const top2 = answers2[0];
      const text2 = `Precio ${top2.sku ? `(${top2.sku}) ` : ''}${top2.producto}: ${top2.precio}`;
      return { answer: text2, matches: answers2 };
    }
  } catch {}

  // No usar IA - devolver mensaje directo
  return { 
    answer: 'No encontré productos que coincidan con tu búsqueda. Probá con otras palabras clave o código de producto.', 
    matches: [] 
  };
}



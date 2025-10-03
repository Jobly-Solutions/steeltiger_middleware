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

/**
 * Extrae el año de la consulta del usuario
 * Ejemplos: "nissan 19" -> 2019, "amarok 2022" -> 2022, "frontier 16" -> 2016
 */
function extractYearFromQuery(question) {
  const normalized = question.toLowerCase().trim();
  
  // Buscar año completo (2016-2024)
  const fullYearMatch = normalized.match(/\b(20[0-2][0-9])\b/);
  if (fullYearMatch) {
    return parseInt(fullYearMatch[1]);
  }
  
  // Buscar año corto (16-24) - solo si está después de una marca/modelo
  const shortYearMatch = normalized.match(/(?:nissan|frontier|amarok|hilux|ranger|alaskan|s10|colorado)\s+['"]?(\d{2})\b/);
  if (shortYearMatch) {
    const twoDigits = parseInt(shortYearMatch[1]);
    // Convertir a año completo (asumiendo 2000s si < 50, sino 1900s)
    return twoDigits >= 0 && twoDigits <= 50 ? 2000 + twoDigits : 1900 + twoDigits;
  }
  
  return null;
}

/**
 * Parsea el rango de años de un texto de producto
 * Ejemplos: "16-21" -> {min: 2016, max: 2021}, "22->" -> {min: 2022, max: null}, "21>" -> {min: 2021, max: null}
 */
function parseYearRange(productText) {
  if (!productText) return null;
  
  // Patrón: "16-21" o "2016-2021"
  const rangeMatch = productText.match(/\b(\d{2}|\d{4})-(\d{2}|\d{4})\b/);
  if (rangeMatch) {
    let min = parseInt(rangeMatch[1]);
    let max = parseInt(rangeMatch[2]);
    
    // Convertir años cortos a completos
    if (min < 100) min = min >= 0 && min <= 50 ? 2000 + min : 1900 + min;
    if (max < 100) max = max >= 0 && max <= 50 ? 2000 + max : 1900 + max;
    
    return { min, max };
  }
  
  // Patrón: "22->" o "21>" (año en adelante)
  const forwardMatch = productText.match(/\b(\d{2}|\d{4})[-]?>+\b/);
  if (forwardMatch) {
    let min = parseInt(forwardMatch[1]);
    if (min < 100) min = min >= 0 && min <= 50 ? 2000 + min : 1900 + min;
    return { min, max: null }; // null = hasta el presente
  }
  
  return null;
}

/**
 * Verifica si un producto es compatible con el año solicitado
 */
function isCompatibleWithYear(productText, targetYear) {
  if (!targetYear || !productText) return true; // Si no hay año, no filtrar
  
  const range = parseYearRange(productText);
  if (!range) return true; // Si no tiene rango, incluirlo
  
  // Verificar si el año está en el rango
  const inRange = targetYear >= range.min && (range.max === null || targetYear <= range.max);
  return inRange;
}

async function extractIntentWithAI(question) {
  // No usar IA, hacer búsqueda directa y exhaustiva
  const words = question.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  
  // Detectar si pregunta por enganches
  const isEngancheQuery = /enganche|enganche|tow|hitch/i.test(question);
  
  return { 
    intent: 'price_lookup', 
    keywords: words, 
    sku: extractCandidateSku(question),
    isEngancheQuery
  };
}

function rankProducts(products, tokens, sku) {
  const normTokens = tokens.map(normalizeText).filter(Boolean);
  
  // Fuzzy: usar Fuse sobre TODOS los campos relevantes con pesos optimizados
  const fuse = new Fuse(products, {
    keys: [
      { name: 'DETALLE1', weight: 0.4 },      // Productos - más peso
      { name: 'DETALLE', weight: 0.4 },       // Precios - más peso
      { name: 'MODELO', weight: 0.3 },        // Modelo importante (hilux, amarok, etc)
      { name: 'MARCA', weight: 0.2 },
      { name: 'RUBRO', weight: 0.2 },         // Precios (enganches, defensas, etc)
      { name: 'SUBRUBRO', weight: 0.2 },      // Precios
      { name: 'CATEGORIA', weight: 0.15 },    // Ambos
      { name: 'COD_ALFABA', weight: 0.1 }     // Ambos
    ],
    includeScore: true,
    threshold: 0.95, // MUY MUY PERMISIVO
    ignoreLocation: true,
    distance: 10000, // Permitir coincidencias MUY lejanas
    minMatchCharLength: 1, // Buscar desde 1 carácter
    shouldSort: true,
    findAllMatches: true, // IMPORTANTE: Encuentra TODAS las coincidencias
    useExtendedSearch: false
  });
  
  const query = normTokens.join(' ');
  let results = query ? fuse.search(query).map((r) => ({ row: r.item, score: 1 - (r.score ?? 0) })) : [];
  
  // Boost por coincidencia exacta de palabras clave en DETALLE1/DETALLE
  results = results.map((r) => {
    let boost = 0;
    const detalle = normalizeText((r.row.DETALLE1 || r.row.DETALLE || ''));
    
    // Boost por cada token que aparece en el detalle
    for (const token of normTokens) {
      if (token.length >= 3 && detalle.includes(token)) {
        boost += 0.5; // Boost por cada palabra encontrada
      }
    }
    
    // Boost EXTRA si las primeras palabras del detalle coinciden
    const primerasPalabras = detalle.split(' ').slice(0, 3).join(' ');
    for (const token of normTokens) {
      if (token.length >= 3 && primerasPalabras.includes(token)) {
        boost += 1.0; // Boost grande si está al principio
      }
    }
    
    return {
      row: r.row,
      score: r.score + boost
    };
  });
  
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
      { name: 'DETALLE', weight: 0.4 },
      { name: 'DETALLE1', weight: 0.4 },
      { name: 'MODELO', weight: 0.3 },
      { name: 'RUBRO', weight: 0.2 },
      { name: 'SUBRUBRO', weight: 0.2 },
      { name: 'MARCA', weight: 0.2 },
      { name: 'COD_ALFABA', weight: 0.1 },
      { name: 'CATEGORIA', weight: 0.1 }
    ],
    includeScore: true,
    threshold: 0.95, // MUY MUY PERMISIVO
    ignoreLocation: true,
    distance: 10000,
    minMatchCharLength: 1,
    shouldSort: true,
    findAllMatches: true
  });
  const query = normTokens.join(' ');
  let results = query ? fuse.search(query).map((r) => ({ row: r.item, score: 1 - (r.score ?? 0) })) : [];
  
  // Boost por coincidencia exacta de palabras clave
  results = results.map((r) => {
    let boost = 0;
    const detalle = normalizeText((r.row.DETALLE || r.row.DETALLE1 || ''));
    
    // Boost por cada token que aparece en el detalle
    for (const token of normTokens) {
      if (token.length >= 3 && detalle.includes(token)) {
        boost += 0.5;
      }
    }
    
    // Boost EXTRA si las primeras palabras del detalle coinciden
    const primerasPalabras = detalle.split(' ').slice(0, 3).join(' ');
    for (const token of normTokens) {
      if (token.length >= 3 && primerasPalabras.includes(token)) {
        boost += 1.0;
      }
    }
    
    return {
      row: r.row,
      score: r.score + boost
    };
  });
  
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

  // Extraer año de la consulta
  const targetYear = extractYearFromQuery(question);
  
  logger.info({
    question,
    extractedYear: targetYear
  }, 'Year extraction from query');

  const tokens = [];
  if (intent?.keywords?.length) tokens.push(...intent.keywords);
  // fallback para palabras comunes
  const fallbackWords = question.split(/\s+/).filter((w) => w.length >= 3);
  tokens.push(...fallbackWords);

  const sku = intent?.sku || extractCandidateSku(question);
  // Sinónimos expandidos
  const synonyms = [
    ['lona maritima', 'cobertor', 'tapa', 'cover', 'lona'],
    ['amarok', 'vw amarok', 'volkswagen amarok', 'vw'],
    ['hilux', 'toyota hilux', 'toyota'],
    ['frontier', 'nissan frontier', 'nissan'],
    ['ranger', 'ford ranger', 'ford'],
    ['s10', 'chevrolet s10', 'chevy s10', 'chevrolet'],
    ['enganche', 'enganches', 'tow', 'hitch', 'enganche st'],
    ['acople', 'acoples', 'bola', 'coupling'],
    ['defensa', 'defensas', 'bumper', 'paragolpe'],
    ['estribos', 'estribo', 'pisaderas', 'step bar'],
    ['barra', 'barras', 'roll bar', 'barra antivuelco']
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

  // Determinar lista a usar: lista del cliente o LISTA 1 por defecto
  let clientList = 'LISTA 1'; // Default
  if (_phoneNumber && _phoneNumber !== '_phoneNumber') {
    const { findClientByPhone } = await import('./braviloClient.js');
    const datasetManager = { getDataset };
    const client = findClientByPhone(_phoneNumber, datasetManager);
    if (client && (client.CATEGORIA || client.LISTA)) {
      clientList = client.CATEGORIA || client.LISTA;
      logger.info({ clientList, phoneNumber: _phoneNumber }, 'Using client assigned list');
    }
  }
  logger.info({ clientList }, 'Price list to use');

  const answers = [];
  for (const prod of candidates) {
    const key = String(prod.COD_ALFABA || '').trim().toUpperCase();
    const plist = priceIdx.get(key) || [];
    if (plist.length === 0) continue;
    
    // Filtrar precios por la lista asignada
    const pricesForList = plist.filter(p => {
      const priceList = (p.CATEGORIA || p.LISTA || '').toUpperCase();
      return priceList === clientList.toUpperCase();
    });
    
    // Si no hay precios para esa lista, usar cualquier precio disponible
    const availablePrices = pricesForList.length > 0 ? pricesForList : plist;
    
    // Elegir el mejor precio (menor PRE_NETO)
    const best = availablePrices.reduce((acc, x) => {
      const accPrice = acc && (acc.PRE_NETO || acc.PRE_BRUTO || Infinity);
      const xPrice = x.PRE_NETO || x.PRE_BRUTO || Infinity;
      return accPrice < xPrice ? acc : x;
    }, null) || availablePrices[0];
    
    const precio = typeof best.PRE_NETO === 'number' ? best.PRE_NETO : (typeof best.PRE_BRUTO === 'number' ? best.PRE_BRUTO : null);
    
    const productoText = prod.DETALLE1 || best.DETALLE || '';
    
    // Filtrar por compatibilidad de año si el usuario especificó un año
    if (!isCompatibleWithYear(productoText, targetYear)) {
      logger.debug({ 
        producto: productoText, 
        targetYear, 
        skipped: true 
      }, 'Product skipped due to year incompatibility');
      continue;
    }
    
    answers.push({
      producto: productoText,
      sku: key,
      marca: prod.MARCA || null,
      modelo: prod.MODELO || null,
      precioNumerico: precio,
      precio: precio != null ? formatCurrency(precio) : 'N/D',
      listaCategoria: best.CATEGORIA || best.LISTA || clientList
    });
  }

  logger.info({ 
    answersCount: answers.length,
    filteredByYear: targetYear ? true : false,
    targetYear 
  }, 'Final answers count (after year filtering)');

  // Si no hay match por productos, intentamos directo con lista de precios
  if (answers.length === 0 && priceOnlyCandidates.length > 0) {
    // Aplicar filtro de año también aquí
    for (const pr of priceOnlyCandidates) {
      const key = String(pr.COD_ALFABA || '').trim().toUpperCase();
      const precio = typeof pr.PRE_NETO === 'number' ? pr.PRE_NETO : (typeof pr.PRE_BRUTO === 'number' ? pr.PRE_BRUTO : null);
      // Enriquecer con info de productos si existe
      const prodMatch = productos.find((p) => String(p.COD_ALFABA || '').trim().toUpperCase() === key);
      const name = prodMatch?.DETALLE1 || pr.DETALLE || '';
      
      // Filtrar por año
      if (!isCompatibleWithYear(name, targetYear)) {
        continue;
      }
      
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
  }

  if (answers.length > 0) {
    // Recomendar acoples si preguntaron por enganches
    const shouldRecommendAcoples = intent?.isEngancheQuery && 
      answers.some(a => /enganche/i.test(a.producto));
    
    // Si hay muchos resultados, devolver resumen con todos los matches
    if (answers.length > 5) {
      let text = targetYear 
        ? `Encontré ${answers.length} productos compatibles con tu ${targetYear}.`
        : `Encontré ${answers.length} productos que coinciden con tu búsqueda.`;
      text += ` Precios según ${clientList}. Nota: Los años se muestran como '16-21' (del 2016 al 2021), '22->' (del 2022 en adelante), etc.`;
      
      if (shouldRecommendAcoples) {
        text += ` 💡 Tip: Los enganches no incluyen acople. Te recomiendo consultar también por acoples para completar la instalación.`;
      }
      
      return { answer: text, matches: answers, clientList };
    }
    const top = answers[0];
    let text = `${top.producto} - ${top.precio} (${clientList})`;
    if (top.sku) {
      text += ` [SKU: ${top.sku}]`;
    }
    
    // Agregar explicación de años si el producto contiene notación de año
    if (/\d{2}[-|>]/.test(top.producto)) {
      text += `. Nota: '18->' significa del 2018 en adelante, '16-21' del 2016 al 2021.`;
    }
    
    // Mencionar el año si se filtró por año
    if (targetYear) {
      text += ` ✅ Compatible con tu ${targetYear}.`;
    }
    
    // Recomendar acoples si es un enganche
    if (shouldRecommendAcoples) {
      text += ` 💡 Importante: Este enganche no incluye acople. ¿Necesitás cotizar acoples también?`;
    }
    
    return { answer: text, matches: answers, clientList };
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



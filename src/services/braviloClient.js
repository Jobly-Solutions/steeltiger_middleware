import { fetch } from 'undici';
import pino from 'pino';

const logger = pino();

const BRAVILO_API_URL = 'https://app.braviloai.com/api/contacts/upsert';
const BRAVILO_TOKEN = process.env.BRAVILO_TOKEN || 'dfa4f286-4371-436c-8372-d5b300c5eb3c';

/**
 * Transform Steel Tiger client data to Bravilo AI contact format
 */
export function transformClientToContact(client) {
  // Extract basic information - ensure externalId is always a string
  const externalId = String(client.CODIGO || client.COD_ALFABA || `cliente_${Date.now()}`);
  
  // Extract email - ensure it's never null, use empty string if not found
  const email = client.EMAIL || client.MAIL || client.CORREO || '';
  
  // Extract phone - ensure it's never null, use empty string if not found
  const phoneNumber = client.TELEFONO || client.PHONE || client.CELULAR || '';
  
  // Extract name information
  const firstName = client.NOMBRE || client.PRIMER_NOMBRE || client.FIRST_NAME || '';
  const lastName = client.APELLIDO || client.SEGUNDO_NOMBRE || client.LAST_NAME || '';
  
  // Create metadata with all available client information
  const metadata = {
    empresa: client.EMPRESA || client.RAZON_SOCIAL || client.COMPANY || '',
    direccion: client.DIRECCION || client.ADDRESS || '',
    ciudad: client.CIUDAD || client.CITY || '',
    provincia: client.PROVINCIA || client.STATE || '',
    codigo_postal: client.CODIGO_POSTAL || client.ZIP_CODE || '',
    cuit: client.CUIT || client.TAX_ID || '',
    tipo_documento: client.TIPO_DOCUMENTO || client.DOC_TYPE || '',
    numero_documento: client.NUMERO_DOCUMENTO || client.DOC_NUMBER || '',
    fecha_alta: client.FECHA_ALTA || client.CREATED_DATE || '',
    fuente: 'steel_tiger',
    // Include any other fields as metadata
    ...Object.fromEntries(
      Object.entries(client).filter(([key, value]) => 
        !['CODIGO', 'COD_ALFABA', 'EMAIL', 'MAIL', 'CORREO', 'TELEFONO', 'PHONE', 'CELULAR', 
          'NOMBRE', 'PRIMER_NOMBRE', 'FIRST_NAME', 'APELLIDO', 'SEGUNDO_NOMBRE', 'LAST_NAME',
          'EMPRESA', 'RAZON_SOCIAL', 'COMPANY', 'DIRECCION', 'ADDRESS', 'CIUDAD', 'CITY',
          'PROVINCIA', 'STATE', 'CODIGO_POSTAL', 'ZIP_CODE', 'CUIT', 'TAX_ID', 'TIPO_DOCUMENTO',
          'DOC_TYPE', 'NUMERO_DOCUMENTO', 'DOC_NUMBER', 'FECHA_ALTA', 'CREATED_DATE'].includes(key)
      )
    )
  };

  return {
    externalId,
    email,
    phoneNumber,
    firstName,
    lastName,
    metadata
  };
}

/**
 * Sync contacts to Bravilo AI
 */
export async function syncContactsToBravilo(contacts) {
  if (!Array.isArray(contacts) || contacts.length === 0) {
    logger.warn('No contacts to sync');
    return { success: true, synced: 0, errors: [] };
  }

  const transformedContacts = contacts
    .map(transformClientToContact)
    .filter(contact => contact.email.trim() || contact.phoneNumber.trim()); // Only sync contacts with email or phone

  if (transformedContacts.length === 0) {
    logger.warn('No valid contacts to sync (missing email and phone)');
    return { 
      success: true, 
      synced: 0, 
      errors: [],
      message: 'No valid contacts found to sync. Contacts must have either email or phone number.'
    };
  }

  const payload = {
    contacts: transformedContacts
  };

  try {
    logger.info(`Syncing ${transformedContacts.length} contacts to Bravilo AI`);
    
    const response = await fetch(BRAVILO_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRAVILO_TOKEN}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bravilo API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    logger.info(`Successfully synced ${transformedContacts.length} contacts to Bravilo AI`);
    
    return {
      success: true,
      synced: transformedContacts.length,
      response: result,
      errors: []
    };

  } catch (error) {
    logger.error({ error }, 'Failed to sync contacts to Bravilo AI');
    return {
      success: false,
      synced: 0,
      errors: [error.message]
    };
  }
}

/**
 * Get contacts from local dataset
 */
export function getContactsFromDataset(datasetManager, datasetKey = 'clientes_ia') {
  try {
    const dataset = datasetManager.getDataset(datasetKey);
    return Array.isArray(dataset.data) ? dataset.data : [];
  } catch (error) {
    logger.error({ error, datasetKey }, 'Failed to get contacts from dataset');
    return [];
  }
}

/**
 * Normalize phone number for comparison
 */
function normalizePhone(phone) {
  if (!phone) return '';
  return String(phone)
    .replace(/[^\d]/g, '') // Remove all non-digits
    .replace(/^54/, '') // Remove Argentina country code
    .replace(/^0/, ''); // Remove leading zero
}

/**
 * Find client by phone number
 */
export function findClientByPhone(phoneNumber, datasetManager) {
  if (!phoneNumber) return null;
  
  const normalizedSearch = normalizePhone(phoneNumber);
  if (!normalizedSearch) return null;
  
  try {
    // Try both client datasets
    const clientes = getContactsFromDataset(datasetManager, 'clientes');
    const clientesIA = getContactsFromDataset(datasetManager, 'clientes_ia');
    const allClients = [...clientes, ...clientesIA];
    
    // Find client by phone match
    const client = allClients.find(client => {
      const clientPhone = client.TELEFONO || client.PHONE || client.CELULAR || '';
      const normalizedClient = normalizePhone(clientPhone);
      return normalizedClient === normalizedSearch;
    });
    
    return client || null;
  } catch (error) {
    logger.error({ error, phoneNumber }, 'Failed to find client by phone');
    return null;
  }
}

/**
 * Get prices for a specific product and client list
 */
export function getPricesForClientList(productCode, clientList, datasetManager) {
  if (!productCode || !clientList) return [];
  
  try {
    const precios = getContactsFromDataset(datasetManager, 'lista_precios');
    
    // Filter prices by product code and client list
    const matchingPrices = precios.filter(precio => {
      const precioCode = String(precio.COD_ALFABA || '').trim().toUpperCase();
      const precioLista = String(precio.CATEGORIA || '').trim();
      return precioCode === String(productCode).trim().toUpperCase() && 
             precioLista === String(clientList).trim();
    });
    
    return matchingPrices;
  } catch (error) {
    logger.error({ error, productCode, clientList }, 'Failed to get prices for client list');
    return [];
  }
}

/**
 * Get best price for a product based on client's list
 */
export function getBestPriceForClient(productCode, phoneNumber, datasetManager) {
  const client = findClientByPhone(phoneNumber, datasetManager);
  if (!client) {
    return {
      found: false,
      error: 'Cliente no encontrado',
      clientList: null,
      price: null
    };
  }
  
  const clientList = client.CATEGORIA || client.LISTA || null;
  if (!clientList) {
    return {
      found: false,
      error: 'Cliente sin lista asignada',
      clientList: null,
      price: null
    };
  }
  
  const prices = getPricesForClientList(productCode, clientList, datasetManager);
  if (prices.length === 0) {
    return {
      found: false,
      error: 'No hay precios para este producto en la lista del cliente',
      clientList,
      price: null
    };
  }
  
  // Get the best price (lowest PRE_NETO or PRE_BRUTO)
  const bestPrice = prices.reduce((best, current) => {
    const currentPrice = current.PRE_NETO || current.PRE_BRUTO || 0;
    const bestPriceValue = best.PRE_NETO || best.PRE_BRUTO || 0;
    return currentPrice < bestPriceValue ? current : best;
  });
  
  return {
    found: true,
    clientList,
    price: bestPrice.PRE_NETO || bestPrice.PRE_BRUTO || 0,
    priceDetails: bestPrice,
    client: {
      codigo: client.CODIGO,
      nombre: client.NOMBRE,
      empresa: client.EMPRESA || client.RAZON_SOCIAL,
      telefono: client.TELEFONO || client.PHONE || client.CELULAR
    }
  };
}

import { fetch } from 'undici';
import pino from 'pino';

const logger = pino();

const BRAVILO_API_URL = 'https://app.braviloai.com/api/contacts/upsert';
const BRAVILO_TOKEN = process.env.BRAVILO_TOKEN || 'dfa4f286-4371-436c-8372-d5b300c5eb3c';

/**
 * Transform Steel Tiger client data to Bravilo AI contact format
 */
export function transformClientToContact(client) {
  // Extract basic information
  const externalId = client.CODIGO || client.COD_ALFABA || `cliente_${Date.now()}`;
  const email = client.EMAIL || client.MAIL || client.CORREO || null;
  const phoneNumber = client.TELEFONO || client.PHONE || client.CELULAR || null;
  
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
    .filter(contact => contact.email || contact.phoneNumber); // Only sync contacts with email or phone

  if (transformedContacts.length === 0) {
    logger.warn('No valid contacts to sync (missing email and phone)');
    return { success: true, synced: 0, errors: [] };
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

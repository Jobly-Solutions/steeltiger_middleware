Steel Tiger Middleware

Servicio Express que sincroniza datos de Steel Tiger cada hora a JSON local y expone endpoints para consulta, búsqueda, join y Q&A con IA en el puerto 3008.

Requisitos
- Node.js 18+
- pnpm (workspace ya configurado)

Instalación
1) Agregado al workspace en `pnpm-workspace.yaml`.
2) Instalar dependencias:
   - `pnpm -F steel-tiger-middleware install`

Configurar entorno
1) Copiar `.env.example` a `.env` y completar credenciales de Steel Tiger:
   - `STEEL_LICENSE`
   - `STEEL_USER`
   - `STEEL_PASSWORD`
   - `STEEL_EMAIL` (email para autorización)
2) Opcional: `OPENAI_API_KEY` para habilitar `/ai/query`.
3) Variables clave:
   - `PORT=3008`
   - `REFRESH_CRON=5 * * * *` (minuto 5 de cada hora por defecto)
   - `DATA_DIR=./data`

Ejecutar
- Producción/local: `pnpm -F steel-tiger-middleware start`
- Dev con autoreload: `pnpm -F steel-tiger-middleware dev`

Datasets sincronizados
- `clientes` (`_query: Clientes`)
- `clientes_ia` (`_query: ClientesIA`) - Nuevo dataset para sincronización con Bravilo AI
- `productos` (`_query: Productos`)
- `lista_precios` (`_query: ListaDePrecios`)

Convenciones de Datos

Notación de Años en Productos:
Los productos de Steel Tiger usan notación especial para años de compatibilidad:
- `16-21` = Del año 2016 al 2021
- `22->` = Del año 2022 en adelante  
- `21>` = Del año 2021 en adelante
- `16` = Solo para el año 2016

Ejemplo: "Defensa Baja Negra para Nissan Frontier 16-21" significa compatible con Nissan Frontier desde 2016 hasta 2021.

Endpoints
- `GET /health` → estado del servicio, `dataDir`, datasets disponibles
- `GET /datasets` → lista de datasets locales
- `GET /data/:dataset` → devuelve datos de un dataset
  - Query params: `q` (búsqueda simple), `limit`, `fields` (coma separada)
  - Ej: `/data/productos?limit=5&fields=COD_ALFABA,DETALLE1`
- `GET /search` → búsqueda cruzada en uno o varios datasets
  - Params: `query`, `dataset` (coma separada), `fields`, `limit`
  - Ej: `/search?query=ENGANCHE&dataset=productos,lista_precios&limit=10`
- `GET /join` → join simple entre 2 datasets por clave
  - Params: `left`, `right`, `leftKey?`, `rightKey?`, `limit?`
  - Si no se indican claves, intenta inferir (`CODIGO` o `COD_ALFABA`)
- `POST /refresh` → fuerza una actualización inmediata de todos los datasets
- `POST /auth` → solicita autorización al proveedor (body opcional `{ "email": "..." }`)
- `POST /ai/query` → Q&A con IA usando muestras del dataset local
  - Body JSON: `{ "question": string, "datasets?": string[], "filters?": { "q?": string, "fields?": string[] }, "limit?": number }`

Endpoints para sincronización con Bravilo AI:
- `GET /clients` → obtiene datos de clientes desde Steel Tiger API (query param: `dataset=clientes_ia`)
- `POST /sync/contacts` → sincroniza contactos locales con Bravilo AI (body: `{ "dataset": "clientes_ia" }`)
- `POST /sync/clients` → refresca datos de clientes y los sincroniza con Bravilo AI
- `POST /sync/clients-to-bravilo` → sincroniza datos de clientes cacheados con Bravilo AI

Endpoints para descarga de datos:
- `GET /download/all` → descarga todos los datasets
  - Query params: `format=zip` (default) o `format=json`
  - ZIP incluye todos los archivos JSON + metadata.json con info de exportación
  - JSON devuelve un objeto con todos los datasets
  - Ej: `/download/all` o `/download/all?format=json`
- `GET /download/:dataset` → descarga un dataset individual en JSON
  - Ej: `/download/productos`, `/download/clientes_ia`
- `GET /download/productos-con-precios` → descarga productos con precios combinados (JOIN)
  - Combina productos con sus precios de todas las listas
  - Incluye metadata con estadísticas (productos con/sin precio)
  - Cada producto incluye array de precios por lista y precio min/max
  - Formato: `{ meta: {...}, data: [{ codigo, detalle, marca, precios: [...], precioMin, precioMax }] }`

Notas de diseño
- Se cachea localmente cada dataset como `data/<dataset>.json` con metadatos de última descarga.
- Refresco automático con `node-cron` (configurable por `REFRESH_CRON`).
- Sincronización automática de clientes con Bravilo AI cada hora (configurable por `CLIENT_SYNC_CRON`).
- Cliente HTTP con `undici` y reintentos exponenciales.
- IA opcional con `openai`; si no hay `OPENAI_API_KEY`, devuelve respuesta de cortesía.
- Transformación automática de datos de Steel Tiger al formato de contactos de Bravilo AI.

Steel Tiger API


se usa el endpoint: https://www.apiarbro.xfoxnet.com/api/RecuperarDatos_ERP_por_Query para todo. Solo se modifica la consulta con _query.

clientes:

{
    "_licencia": "9fe34943-a829-43fb-b9cc-87a63ec5aa53",
    "_usuario": "UsuApiRest1",
    "_password": "Usu@2025",
    "_cuit": "0",
    "_query": "Clientes",
    "_parametros":null,
    "jsonPuro":true
}

clientes_ia (nuevo):

{
    "_licencia": "9fe34943-a829-43fb-b9cc-87a63ec5aa53",
    "_usuario": "UsuApiRest1",
    "_password": "Usu@2025",
    "_cuit": "0",
    "_query": "ClientesIA",
    "_parametros":null,
    "jsonPuro":true
}

api openai steeltiger:

Ejemplo respuesta para clientes:

{
    "Respuesta": "Select ejecutado con exito! --> SQL: SELECT CODIGO, CUIT, NOMBRE, CATEGORIA, ALLTRIM(CAST(strtran(strtran(E_MAIL,CHR(10),\"\"),chr(13),\"\") AS C(254))) AS EMAIL, PASSW_WEB FROM CLIENTES WHERE INLIST(CATEGORIA,\"LISTA 1\",\"LISTA 2\",\"LISTA 3\",\"LISTA 4\",\"LISTA 5\",\"LISTA 6\",\"LISTA 7\")",
    "Comando": "SELECT CODIGO, CUIT, NOMBRE, CATEGORIA, ALLTRIM(CAST(strtran(strtran(E_MAIL,CHR(10),\"\"),chr(13),\"\") AS C(254))) AS EMAIL, PASSW_WEB FROM CLIENTES WHERE INLIST(CATEGORIA,\"LISTA 1\",\"LISTA 2\",\"LISTA 3\",\"LISTA 4\",\"LISTA 5\",\"LISTA 6\",\"LISTA 7\")",
    "Datos": [
        {
            "CODIGO": 2,a
            "CUIT": 30692919994.0,
            "NOMBRE": "ABC ACCESORIOS SRL",
            "CATEGORIA": "LISTA 3",
            "EMAIL": "info@abcaccesorios.com.ar",
            "PASSW_WEB": ""
        },
        ...
}

----------------------------------------------------

productos:

{
    "_licencia": "9fe34943-a829-43fb-b9cc-87a63ec5aa53",
    "_usuario": "UsuApiRest1",
    "_password": "Usu@2025",
    "_cuit": "0",
    "_query": "Productos",    
    "_parametros":null,
    "jsonPuro":true
}

Ejemplo respuesta para productos:

{
    "Respuesta": "Select ejecutado con exito! --> SQL: SELECT S.COD_ALFABA, S.DETALLE1, S.CATEG_WEB1 AS CATEGORIA, S.MARCA_C AS MARCA, S.MODELO FROM STOCK S WHERE !DETALLE LIKE \"*%\" AND ECOMMERCE=.T.",
    "Comando": "SELECT S.COD_ALFABA, S.DETALLE1, S.CATEG_WEB1 AS CATEGORIA, S.MARCA_C AS MARCA, S.MODELO FROM STOCK S WHERE !DETALLE LIKE \"*%\" AND ECOMMERCE=.T.",
    "Datos": [
        {
            "COD_ALFABA": "001.002.0077",
            "DETALLE1": "JUEGO PATENTE P/ TRAILER GENERICA ARGENTINA",
            "CATEGORIA": "Off Road",
            "MARCA": "TODAS",
            "MODELO": "TODOS"
        },
        ...

}

----------------------------------------------------

Bravilo AI Integration

El middleware ahora incluye sincronización automática con Bravilo AI:

Configuración:
- `BRAVILO_TOKEN`: Token de autorización para Bravilo AI (por defecto: dfa4f286-4371-436c-8372-d5b300c5eb3c)
- `CLIENT_SYNC_CRON`: Cron para sincronización automática (por defecto: cada hora)

Transformación de datos:
Los datos de Steel Tiger se transforman automáticamente al formato de contactos de Bravilo AI:
- `externalId`: CODIGO o COD_ALFABA del cliente
- `email`: EMAIL, MAIL o CORREO del cliente
- `phoneNumber`: TELEFONO, PHONE o CELULAR del cliente
- `firstName`: NOMBRE, PRIMER_NOMBRE o FIRST_NAME del cliente
- `lastName`: APELLIDO, SEGUNDO_NOMBRE o LAST_NAME del cliente
- `metadata`: Información adicional como empresa, dirección, etc.

Sincronización automática:
- Se ejecuta cada hora por defecto
- Solo sincroniza contactos que tengan email o teléfono
- Incluye todos los campos del cliente en metadata
- Logs detallados de éxito/error

Consulta de precios por teléfono:
- Integrado en endpoint: `POST /ai/query`
- Parámetros adicionales: `_phoneNumber` y `productCode`
- Busca el cliente por teléfono y obtiene su lista asignada
- Devuelve el precio específico para esa lista
- Normaliza números de teléfono automáticamente
- Ejemplo de uso:
  ```json
  {
    "question": "¿Cuánto cuesta el producto?",
    "_phoneNumber": "+54 11 1234-5678",
    "productCode": "ENG001"
  }
  ```

Endpoints de sincronización:
- `GET /clients` - Obtener datos de clientes desde Steel Tiger
- `POST /sync/contacts` - Sincronizar contactos locales con Bravilo AI
- `POST /sync/clients` - Refrescar y sincronizar datos de clientes
- `POST /sync/clients-to-bravilo` - Sincronizar datos cacheados con Bravilo AI

----------------------------------------------------

lista precios:

{
    "_licencia": "9fe34943-a829-43fb-b9cc-87a63ec5aa53",
    "_usuario": "UsuApiRest1",
    "_password": "Usu@2025",
    "_cuit": "0",
    "_query": "ListaDePrecios",    
    "_parametros":null,
    "jsonPuro":true
}

Ejemplo respuesta para lista de precios:

{
    "Respuesta": "Select ejecutado con exito! --> SQL: SELECT \"LISTA 0\" as categoria, s2.codigo, s2.cod_alfaba, s2.detalle1 as detalle, s2.rubro, s2.subrubro, \"\" as grupo_dto, dl2.precio as pre_bruto, 0 as dto, dl2.precio as pre_neto FROM stock s2 LEFT JOIN dlistapr dl2 ON s2.codigo=dl2.codigo WHERE NOT s2.detalle like \"*%\" AND s2.ecommerce=.t. AND NOT s2.detalle like \"*%\" union all SELECT d.categoria, s.codigo, s.cod_alfaba, s.detalle1 as detalle, s.rubro, s.subrubro, s.grupo_dto, dl.precio as pre_bruto, d.dto, dl.precio*(1-(d.dto/100)) as pre_neto FROM stock s LEFT JOIN dtos d ON s.grupo_dto=d.grupo LEFT JOIN dlistapr dl ON s.codigo=dl.codigo WHERE NOT ISNULL(d.categoria) AND NOT s.detalle like \"*%\" AND d.categoria=\"LISTA \" AND s.ecommerce=.t. AND NOT s.detalle like \"*%\" AND DATE() between d.desde AND d.hasta",
    "Comando": "SELECT \"LISTA 0\" as categoria, s2.codigo, s2.cod_alfaba, s2.detalle1 as detalle, s2.rubro, s2.subrubro, \"\" as grupo_dto, dl2.precio as pre_bruto, 0 as dto, dl2.precio as pre_neto FROM stock s2 LEFT JOIN dlistapr dl2 ON s2.codigo=dl2.codigo WHERE NOT s2.detalle like \"*%\" AND s2.ecommerce=.t. AND NOT s2.detalle like \"*%\" union all SELECT d.categoria, s.codigo, s.cod_alfaba, s.detalle1 as detalle, s.rubro, s.subrubro, s.grupo_dto, dl.precio as pre_bruto, d.dto, dl.precio*(1-(d.dto/100)) as pre_neto FROM stock s LEFT JOIN dtos d ON s.grupo_dto=d.grupo LEFT JOIN dlistapr dl ON s.codigo=dl.codigo WHERE NOT ISNULL(d.categoria) AND NOT s.detalle like \"*%\" AND d.categoria=\"LISTA \" AND s.ecommerce=.t. AND NOT s.detalle like \"*%\" AND DATE() between d.desde AND d.hasta",
    "Datos": [
        {
            "CATEGORIA": "LISTA 0",
            "CODIGO": 21.0,
            "COD_ALFABA": "ASE011",
            "DETALLE": "CONECTOR ELÉCTRICO MACHO-HEMBRA 7 PINES PVC",
            "RUBRO": "STEEL TIGER",
            "SUBRUBRO": "ENGANCHES",
            "GRUPO_DTO": "",
            "PRE_BRUTO": 21905.5939,
            "DTO": 0.000,
            "PRE_NETO": 21905.59385651
        },
        ...
}
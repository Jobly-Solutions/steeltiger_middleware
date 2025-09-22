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
- `productos` (`_query: Productos`)
- `lista_precios` (`_query: ListaDePrecios`)

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

Notas de diseño
- Se cachea localmente cada dataset como `data/<dataset>.json` con metadatos de última descarga.
- Refresco automático con `node-cron` (configurable por `REFRESH_CRON`).
- Cliente HTTP con `undici` y reintentos exponenciales.
- IA opcional con `openai`; si no hay `OPENAI_API_KEY`, devuelve respuesta de cortesía.

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
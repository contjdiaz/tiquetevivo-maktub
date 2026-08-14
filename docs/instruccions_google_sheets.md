# Integracion opcional: Google Sheets como vista administrativa

Esta integracion permite que una persona no tecnica revise pedidos y negocios desde Google Sheets sin entrar a Supabase.

## Recomendacion de arquitectura

Usar Google Sheets como espejo administrativo, no como base principal.

Flujo recomendado:

```text
Panel TiqueteVivo -> Netlify Function -> Supabase -> Google Sheets
```

Supabase sigue siendo la fuente principal porque es mas confiable para consultas, integridad de datos y crecimiento del producto. Google Sheets sirve para revision, seguimiento comercial, exportaciones y administracion simple.

## Que se envia a Google Sheets

El proyecto puede enviar:

- Negocios creados o actualizados.
- Pedidos creados.

Cada envio incluye un campo `type`:

```text
business
order
```

El Apps Script usa ese campo para escribir en la hoja correcta.

## Crear el Google Sheet

1. Crea un archivo en Google Sheets.
2. Crea dos hojas con estos nombres exactos:
   - `Businesses`
   - `Orders`
3. Ve a `Extensiones > Apps Script`.
4. Borra el contenido inicial y pega el script de esta guia.

## Apps Script recomendado

```js
const SECRET_TOKEN = 'CAMBIA_ESTE_TOKEN_LARGO';

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');

    if (SECRET_TOKEN && payload.token !== SECRET_TOKEN) {
      return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
    }

    if (payload.type === 'business') {
      appendBusiness(payload.business || {}, payload);
      return jsonResponse({ ok: true, type: 'business' });
    }

    if (payload.type === 'order') {
      appendOrder(payload.order || {}, payload.business || {}, payload);
      return jsonResponse({ ok: true, type: 'order' });
    }

    return jsonResponse({ ok: false, error: 'Unknown type' }, 400);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message }, 500);
  }
}

function appendBusiness(business, payload) {
  const sheet = getSheet('Businesses', [
    'Fecha sync', 'Slug', 'Nombre', 'Telefono', 'Direccion', 'Ciudad', 'Color', 'Creado', 'Actualizado'
  ]);

  sheet.appendRow([
    new Date(),
    business.slug || '',
    business.name || '',
    business.phone || '',
    business.address || '',
    business.city || '',
    business.color || '',
    business.created_at || '',
    business.updated_at || payload.sentAt || ''
  ]);
}

function appendOrder(order, business, payload) {
  const sheet = getSheet('Orders', [
    'Fecha sync', 'Negocio', 'Slug', 'Tiquete', 'Cliente', 'WhatsApp', 'Detalle',
    'Total', 'Abono', 'Saldo', 'Estado', 'Entrega', 'Creado', 'WhatsApp enviado'
  ]);

  sheet.appendRow([
    new Date(),
    business.name || '',
    business.slug || '',
    order.order_number || '',
    order.customer_name || '',
    order.customer_phone || '',
    order.items_text || '',
    Number(order.total || 0),
    Number(order.paid || 0),
    Number(order.balance || 0),
    order.status || '',
    order.due_date || '',
    order.created_at || '',
    order.whatsapp_sent_at || ''
  ]);
}

function getSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function jsonResponse(data, statusCode) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
```

Nota: Apps Script `ContentService` no permite controlar realmente el HTTP status code en una web app simple. El parametro `statusCode` queda como documentacion interna.

## Publicar Apps Script como Web App

1. En Apps Script, clic en `Implementar > Nueva implementacion`.
2. En tipo, selecciona `App web`.
3. Configura:
   - Ejecutar como: `Yo`.
   - Quien tiene acceso: `Cualquier persona`.
4. Clic en `Implementar`.
5. Autoriza los permisos.
6. Copia la URL que termina en `/exec`.

Google Apps Script requiere que una app web tenga `doGet` o `doPost` y que devuelva `HtmlOutput` o `TextOutput`. Para esta integracion usamos `doPost` y `ContentService.createTextOutput`.

## Configurar Netlify local

En `.env` agrega:

```env
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/XXXXX/exec
GOOGLE_SHEETS_WEBHOOK_TOKEN=CAMBIA_ESTE_TOKEN_LARGO
```

El token debe ser igual al `SECRET_TOKEN` del Apps Script.

Reinicia Netlify:

```powershell
npm run dev
```

## Probar

1. Abre `http://localhost:8888/app.html`.
2. Crea un pedido.
3. Verifica que el pedido aparece en Supabase.
4. Verifica que tambien aparece en la hoja `Orders`.

Tambien puedes probar manualmente:

```powershell
Invoke-RestMethod -Method Post "http://localhost:8888/api/create-order" `
  -ContentType "application/json" `
  -Body '{"slug":"majesty","customerName":"Cliente Prueba","customerPhone":"+573102688991","itemsText":"1 camisa","total":25000,"paid":10000,"status":"RECEIVED"}'
```

## Limitaciones de Google Sheets

Google Sheets es excelente para supervision humana, pero no debe ser la base principal porque:

- No maneja bien concurrencia alta.
- Es mas dificil garantizar integridad relacional.
- Puede tener limites de Apps Script.
- Es mas facil que alguien edite datos por accidente.
- Las consultas complejas y auditoria son mejores en Supabase.

## Uso recomendado para la administradora

La persona administradora puede usar Sheets para:

- Revisar pedidos creados.
- Filtrar por cliente o estado.
- Hacer seguimiento de saldos.
- Exportar reportes.
- Revisar nuevos negocios o leads.

Tu administracion tecnica sigue en Supabase.
# Contrato de la API del chat interno (tarjeta 13)

Comportamiento real de `barrio-backend` en la rama `feature/internal-chat`. Salvo donde pone *(sin test)*, cada afirmación está cubierta por un test en `src/routes/chat.test.ts`, `src/routes/exchanges.test.ts`, `src/services/exchangeService.test.ts` o `src/middleware/errorHandler.test.ts`.

## Convenciones comunes

- **Base:** todas las rutas cuelgan de `/api/exchanges` y exigen `Authorization: Bearer <idToken de Firebase>`.
- **El chat es el propio intercambio:** el `:id` de todas las rutas es el `id` del `Exchange`. No hay un recurso "conversación" aparte.
- **Fechas:** cadenas ISO 8601 en UTC (`"2026-10-17T14:05:24.000Z"`).
- **Errores:** siempre llegan como `{ "error": "<valor>" }`. Hay dos tipos de valor:
  - **Código estable en `snake_case`:** `chat_closed`, `already_confirmed`, `invalid_transition`, `internal_error`, `invalid_request`. El frontend puede ramificar con ellos.
  - **Texto legible:** en 401, 404 y 400 el valor es una frase (`"Exchange not found"`, `"text es obligatorio y debe ser un texto"`…), no un código. Ramifica por el status HTTP, no por el texto, porque puede cambiar.
- **Quién puede ver un chat:** solo las dos personas del intercambio, la proponente y la autora de la card (la receptora). Cualquier otra persona recibe exactamente la misma respuesta que si el intercambio no existiera (`404 "Exchange not found"`), sea cual sea el estado o el cuerpo de la petición.
- **Privacidad:** ninguna respuesta incluye emails ni teléfonos. De la otra persona solo salen `id`, `name` y `avatar`.

### Errores que puede devolver cualquier ruta del chat

| Status | `error` | Cuándo |
|---|---|---|
| 401 | `Token no proporcionado` | Falta la cabecera `Authorization` o no empieza por `Bearer `. |
| 401 | `Token inválido o expirado` | Firebase rechaza el token. |
| 404 | `Usuario no registrado` | El token es válido, pero esa usuaria no existe en la base de datos. |
| 404 | `Exchange not found` | El intercambio no existe o no participas en él. |
| 400 | `invalid_request` | El cuerpo no es JSON válido (solo rutas con cuerpo). Se comprueba antes que el token. |
| 413 | `invalid_request` | El cuerpo supera el límite por defecto de `express.json` (100 kB). *(sin test)* |
| 500 | `internal_error` | Error no controlado. Nunca incluye detalles internos. El manejador es común a todas las rutas; está probado a través de `PATCH /:id/confirm`. |

En las tablas de cada endpoint solo aparecen los errores propios de ese endpoint.

## `GET /api/exchanges/:id`: detalle del intercambio

Lo necesario para pintar la cabecera del chat y sus botones. Funciona en cualquier estado.

**Petición:** sin cuerpo.

**Respuesta `200`** (ejemplo: la autora de una card `request` en `accepted`, sin confirmar todavía):

```json
{
  "id": "6f1c2a8e-3b4d-4c5e-9f60-1a2b3c4d5e6f",
  "status": "accepted",
  "hours": 3,
  "card": { "id": "a7b8c9d0-1e2f-4a3b-8c4d-5e6f7a8b9c0d", "title": "Regar plantas", "type": "request" },
  "other": { "id": "0d9c8b7a-6f5e-4d3c-2b1a-0f9e8d7c6b5a", "name": "Ana", "avatar": "" },
  "myConfirmed": false,
  "otherConfirmed": false,
  "actions": ["cancel", "confirm"]
}
```

### Qué significa cada campo

| Campo | Significado |
|---|---|
| `id` | Id del intercambio, que es también el id del chat. |
| `status` | `proposed`, `accepted`, `done`, `confirmed`, `rated`, `cancelled` o `rejected` (`pending` existe en el schema pero no se usa). |
| `hours` | Horas del intercambio, fijadas al proponer. Son las que se transfieren al confirmar, aunque la card cambie después. |
| `card` | `id`, `title` y `type` (`offer` o `request`) de la card. Sale aunque la card esté `completed`, `reported` o `deleted`. |
| `other` | La otra persona del intercambio, vista desde quien pregunta: `id`, `name` y `avatar` (`""` si no tiene). |
| `myConfirmed` | `true` si quien pregunta ya ha confirmado que el intercambio se hizo. |
| `otherConfirmed` | `true` si la otra persona ya ha confirmado. |
| `actions` | Acciones que quien pregunta puede hacer ahora. Ver abajo. |

### Cómo se compone `actions`

El backend calcula la lista con las mismas reglas que aplica cuando se ejecuta cada acción, así que el frontend no tiene que repetirlas. Siempre sale en este orden: `accept`, `reject`, `cancel`, `confirm`.

| Acción | Aparece si… | Endpoint |
|---|---|---|
| `accept` | Estado `proposed`, pregunta la autora (receptora) y la card sigue `active` sin otro intercambio `accepted` o `done`. | `PATCH /:id/accept` |
| `reject` | Estado `proposed` y pregunta la autora. | `PATCH /:id/reject` |
| `cancel` | Estado `proposed` o `accepted`, pregunte quien pregunte de las dos. | `PATCH /:id/cancel` |
| `confirm` | Estado `accepted` o `done` y quien pregunta todavía no ha confirmado. | `PATCH /:id/confirm` |

Resultado por estado y rol:

| Estado | Ya confirmó | Autora (receptora) | Proponente |
|---|---|---|---|
| `proposed` | — | `accept`, `reject`, `cancel` | `cancel` |
| `proposed`, card no disponible | — | `reject`, `cancel` | `cancel` |
| `accepted` | nadie | `cancel`, `confirm` | `cancel`, `confirm` |
| `done` | la proponente | `confirm` | (ninguna) |
| `done` | la autora | (ninguna) | `confirm` |
| `confirmed`, `rated` | las dos | (ninguna) | (ninguna) |
| `cancelled`, `rejected` | — | (ninguna) | (ninguna) |

"Card no disponible" es cuando ya no está `active` o cuando otro intercambio de la misma card ya está `accepted` o `done`.

- **El saldo no entra en `actions`:** `accept` puede aparecer y aun así fallar con `409 insufficient_balance` si la pagadora no tiene horas disponibles. *(sin test que combine las dos cosas; cada una por separado sí lo tiene)*
- **Las rutas `accept`, `reject` y `cancel` no han cambiado:** responden con el `Exchange` en crudo, no con este detalle. Tras usarlas, vuelve a pedir `GET /:id`.

**Errores propios:** ninguno, aparte de los comunes.

## `GET /api/exchanges/:id/messages`: lista de mensajes

Funciona en cualquier estado, incluidos `cancelled`, `rejected`, `confirmed`, `rated` y los intercambios denunciados, para las dos personas.

**Petición:** sin cuerpo.

**Respuesta `200`:** ordenados por `sentAt` de más antiguo a más reciente. `[]` si no hay mensajes.

```json
[
  { "id": "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d", "text": "¿Quedamos el sábado?", "sentAt": "2026-10-01T10:00:00.000Z", "mine": true },
  { "id": "5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a", "text": "El sábado me va bien", "sentAt": "2026-10-02T10:00:00.000Z", "mine": false }
]
```

| Campo | Significado |
|---|---|
| `id` | Id del mensaje. |
| `text` | Texto tal como se guardó (ya recortado). |
| `sentAt` | Momento en que se guardó, con la hora de la base de datos. |
| `mine` | `true` si lo envió quien pregunta. No se expone nada más sobre quién lo envió. |

**Errores propios:** ninguno, aparte de los comunes.

## `POST /api/exchanges/:id/messages`: enviar un mensaje

**Petición:**

```json
{ "text": "¿Te va bien el sábado a las 10?" }
```

- **`text`:** obligatorio. Se recortan los espacios del principio y del final. Después de recortar debe tener entre 1 y 2000 caracteres: solo espacios cuenta como vacío y exactamente 2000 es válido.

**Respuesta `201`:** el mensaje guardado, con el mismo formato que en la lista.

```json
{ "id": "9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d", "text": "¿Te va bien el sábado a las 10?", "sentAt": "2026-10-17T14:05:24.000Z", "mine": true }
```

**Orden de comprobación:** 401 → 404 → 400 → 409. Así, una tercera persona nunca distingue "existe pero está cerrado" de "no existe".

| Status | `error` | Cuándo |
|---|---|---|
| 400 | `text es obligatorio y debe ser un texto` | Falta `text`, no es una cadena, o queda vacío al recortar. |
| 400 | `text debe tener 2000 caracteres como máximo` | Tiene más de 2000 caracteres tras recortar. |
| 409 | `chat_closed` | El intercambio está `cancelled`, `rejected`, `confirmed` o `rated`. Solo se puede escribir en `proposed`, `accepted` y `done`. |

Si alguien envía un mensaje justo mientras la otra persona cancela o confirma, solo hay dos resultados posibles: el mensaje se guarda antes del cambio de estado, o recibe `409 chat_closed`. Nunca se guarda un mensaje en un chat ya cerrado.

## `PATCH /api/exchanges/:id/confirm`: confirmar que el intercambio se hizo

Cada persona confirma por su lado:

1. **Primera confirmación** (`accepted` → `done`): guarda la confirmación de quien confirma y la fecha `doneAt`. La card pasa a `completed` solo si estaba `active`; una card `reported` o `deleted` conserva su estado, y la confirmación sigue adelante igual. Las horas siguen reservadas a la pagadora y todavía no se mueve nada.
2. **Segunda confirmación** (`done` → `confirmed`), de la persona que aún no había confirmado: guarda su confirmación y la fecha `confirmedAt`, y crea **una** transferencia de `hours` horas de la pagadora a la otra persona. Todo ocurre en la misma transacción.
   - Paga quien recibe la ayuda: en una card `offer` paga la proponente; en una card `request`, la autora.
   - Efecto en el saldo: la pagadora tiene el mismo disponible antes y después (su saldo y su reservado bajan `hours` a la vez). La otra persona suma `hours` a su saldo.

Si las dos confirman a la vez, el resultado es el mismo que una tras otra: `confirmed` y una sola transferencia.

**Petición:** sin cuerpo.

**Respuesta `200`:** el detalle, con el mismo formato que `GET /:id`, ya actualizado. Ejemplo tras la segunda confirmación:

```json
{
  "id": "6f1c2a8e-3b4d-4c5e-9f60-1a2b3c4d5e6f",
  "status": "confirmed",
  "hours": 3,
  "card": { "id": "a7b8c9d0-1e2f-4a3b-8c4d-5e6f7a8b9c0d", "title": "Regar plantas", "type": "request" },
  "other": { "id": "0d9c8b7a-6f5e-4d3c-2b1a-0f9e8d7c6b5a", "name": "Ana", "avatar": "" },
  "myConfirmed": true,
  "otherConfirmed": true,
  "actions": []
}
```

**Orden de comprobación:** 401 → 404 → `already_confirmed` → `invalid_transition`.

| Status | `error` | Cuándo |
|---|---|---|
| 409 | `already_confirmed` | Quien confirma ya lo había hecho. Incluye a las dos personas en `confirmed` y `rated`. Si la misma persona confirma dos veces a la vez, una petición recibe 200 y la otra este error. |
| 409 | `invalid_transition` | El estado no es `accepted` ni `done` y quien confirma no había confirmado: `proposed`, `cancelled`, `rejected`. |
| 500 | `internal_error` | Defensa interna: el intercambio ya tenía una transferencia. No debería ocurrir; si ocurre, no se cambia nada. |

El frontend puede tratar `already_confirmed` e `invalid_transition` igual: "esta acción ya no está disponible, refresca el detalle".

## `POST /api/exchanges/:id/report`: denunciar la conversación

Registra una denuncia contra la otra persona del intercambio.

- **Cuándo:** en cualquier estado.
- **Qué no cambia:** el estado del intercambio, el de la card y los mensajes. El chat sigue legible para las dos personas.
- **Qué ve la denunciada:** nada. Sus respuestas son idénticas antes y después de la denuncia.
- **Repetir:** denunciar varias veces la misma conversación está permitido.

**Petición:**

```json
{ "reason": "Me pide el teléfono para quedar fuera de la app" }
```

- **`reason`:** obligatorio. Se recorta; después de recortar debe tener entre 1 y 1000 caracteres (exactamente 1000 es válido).

**Respuesta `201`:** solo el id y la fecha. Ni el motivo ni datos de la persona denunciada.

```json
{ "id": "3e4f5a6b-7c8d-4e9f-a0b1-c2d3e4f5a6b7", "createdAt": "2026-10-17T14:05:24.000Z" }
```

**Lo que se guarda:** `exchangeId`, `reporterId` (quien denuncia), `reportedUserId` (la otra persona), `reason`, `status: "pending"` y `cardId: null`. `cardId` va vacío a propósito: así nunca se confunde con una denuncia de card, que oculta la card. Revisar las denuncias es cosa de la tarjeta 18.

**Orden de comprobación:** 401 → 404 → 400. No hay ningún 409.

| Status | `error` | Cuándo |
|---|---|---|
| 400 | `reason es obligatorio y debe ser un texto` | Falta `reason`, no es una cadena, o queda vacío al recortar. |
| 400 | `reason debe tener 1000 caracteres como máximo` | Tiene más de 1000 caracteres tras recortar. |

## Efectos sobre los endpoints de la tarjeta 12

Cuando la card pasa a `completed` tras la primera confirmación:

- **`GET /api/exchanges/card/:cardId`:** devuelve `cardAvailable: false`, y `mine` sigue mostrando la propuesta de quien pregunta (también a una tercera persona con una propuesta `proposed`).
- **`POST /api/exchanges`:** proponer sobre esa card devuelve `409 card_unavailable`.
- **Propuestas `proposed` de otras personas sobre la misma card:** se quedan como están. Aceptarlas devuelve `409 card_unavailable` (y `accept` no aparece en `actions`); rechazarlas o cancelarlas funciona.
- **Un intercambio `done`:** no se puede cancelar (`409 invalid_transition`).

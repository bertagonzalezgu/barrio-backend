# Contrato de la API de valoraciones y perfil público (tarjeta 14)

Comportamiento real de `barrio-backend` tras la tarjeta 14 (valoraciones, rama `feature/ratings`). Salvo donde pone *(sin test)*, cada afirmación está cubierta por un test en `src/routes/ratings.test.ts`, `src/routes/users.test.ts`, `src/routes/cards.test.ts`, `src/routes/chat.test.ts` o `src/services/ratingService.test.ts`.

Los cambios en el detalle del intercambio (`myRating` y la acción `rate`) están en [`chat-api-contract.md`](./chat-api-contract.md#get-apiexchangesid-detalle-del-intercambio).

## Convenciones comunes

- **Autenticación:** las dos rutas exigen `Authorization: Bearer <idToken de Firebase>`.
- **Fechas, formato de errores y errores comunes** (401, `404 Usuario no registrado`, `400 invalid_request`, `500 internal_error`): los mismos que en el [contrato del chat](./chat-api-contract.md#convenciones-comunes).
- **Escala:** `score` es un entero de 1 a 5. La base de datos también lo comprueba (`CHECK`), aunque una petición nunca llega a ella con otro valor.
- **Privacidad:** ninguna respuesta incluye email, `firebaseUid`, teléfono ni datos del wallet. Los comentarios de las valoraciones no salen en ningún endpoint: solo los ve quien los escribió, en su propio `myRating`.
- **La valoración no es obligatoria:** no valorar no bloquea nada (ni el chat, ni el wallet, ni otras acciones). Valorar tampoco toca el saldo: no crea ni cambia ninguna `TimeTransaction`.

## `POST /api/exchanges/:id/rating`: valorar a la otra persona

Cada participante valora a la otra persona una vez, cuando el intercambio ya está `confirmed`.

1. **Primera valoración:** se guarda y el intercambio sigue en `confirmed`.
2. **Segunda valoración** (la de la otra persona): se guarda y, en la misma transacción, el intercambio pasa a `rated` con la fecha `ratedAt`.

Si las dos valoran a la vez, el resultado es el mismo que una tras otra: `rated` y dos valoraciones. Las dos peticiones hacen fila tras el mismo bloqueo que usa `PATCH /:id/confirm`.

**Petición:**

```json
{ "score": 4, "comment": "Muy puntual" }
```

- **`score`:** obligatorio. Número entero entre 1 y 5, ambos incluidos. No se convierte nada: `"4"`, `2.5` y `null` se rechazan.
- **`comment`:** opcional. Se recortan los espacios del principio y del final. Ausente, vacío o solo espacios se guarda como `null`. Después de recortar puede tener como máximo 500 caracteres (exactamente 500 es válido). Si se envía, tiene que ser una cadena: `null` o un número dan 400.

**Respuesta `201`:** el detalle del intercambio, con el mismo formato que `GET /api/exchanges/:id`, ya actualizado. Es idéntico a pedir el detalle justo después, así que el frontend puede guardarlo en caché sin otra petición. Ejemplo: la proponente valora primero.

```json
{
  "id": "6f1c2a8e-3b4d-4c5e-9f60-1a2b3c4d5e6f",
  "status": "confirmed",
  "hours": 3,
  "card": { "id": "a7b8c9d0-1e2f-4a3b-8c4d-5e6f7a8b9c0d", "title": "Regar plantas", "type": "request" },
  "other": { "id": "0d9c8b7a-6f5e-4d3c-2b1a-0f9e8d7c6b5a", "name": "Ana", "avatar": "" },
  "myConfirmed": true,
  "otherConfirmed": true,
  "myRating": { "score": 4, "comment": "Muy puntual" },
  "actions": []
}
```

Tras la segunda valoración, `status` es `"rated"`.

**Lo que se guarda:** `exchangeId`, `raterId` (quien valora), `ratedUserId` (la otra persona del intercambio), `score`, `comment` y `createdAt`.

**Orden de comprobación:** 401 → 404 → 400 → 409. Una tercera persona recibe siempre la misma respuesta que si el intercambio no existiera, sea cual sea el cuerpo y el estado.

| Status | `error` | Cuándo |
|---|---|---|
| 404 | `Usuario no registrado` | El token es válido, pero esa usuaria no existe en la base de datos. |
| 404 | `Exchange not found` | El intercambio no existe o no participas en él, también con un cuerpo inválido y en cualquier estado. |
| 400 | `score es obligatorio y debe ser un entero entre 1 y 5` | Falta `score`, no es un número entero (`"4"`, `2.5`, `null`) o está fuera de 1-5. |
| 400 | `comment debe ser un texto` | `comment` está presente y no es una cadena (incluido `null`). |
| 400 | `comment debe tener 500 caracteres como máximo` | `comment` tiene más de 500 caracteres tras recortar. |
| 409 | `not_confirmed` | El estado es `proposed`, `accepted`, `done`, `cancelled` o `rejected`. No se guarda nada. |
| 409 | `already_rated` | Quien valora ya lo había hecho. Incluye a las dos personas en `rated`. No cambia la valoración anterior. Si la misma persona valora dos veces a la vez, una petición recibe 201 y la otra este error. |

Dentro del 409 va primero `not_confirmed` y después `already_rated`. Con un cuerpo inválido en un intercambio no confirmado, la respuesta es 400.

- **Sin edición ni borrado:** una valoración no se puede cambiar una vez enviada.
- **Defensa interna:** si dos valoraciones de la misma persona llegaran a chocar en la base de datos (el índice único `[exchangeId, raterId]`), la respuesta es `409 already_rated`, nunca un 500. Con el bloqueo no debería ocurrir.

## `GET /api/users/:id`: perfil público mínimo

Lo que cualquier usuaria registrada puede ver de otra (o de sí misma): datos básicos, la valoración media, cuántos intercambios ha completado y desde cuándo está en barrio.

**Petición:** sin cuerpo. `:id` es el `id` de la usuaria (el mismo que sale en `other.id` del chat), no su `firebaseUid`.

**Respuesta `200`:**

```json
{
  "id": "0d9c8b7a-6f5e-4d3c-2b1a-0f9e8d7c6b5a",
  "name": "Ana",
  "avatar": "",
  "verified": true,
  "ratingAverage": 4.8,
  "ratingCount": 5,
  "exchangeCount": 7,
  "createdAt": "2026-09-29T15:27:03.000Z"
}
```

| Campo | Significado |
|---|---|
| `id` | Id de la usuaria. |
| `name` | Su nombre. |
| `avatar` | URL de su avatar, o `""` si no tiene. *(sin test el valor `""` en esta ruta)* |
| `verified` | `true` si ha verificado su identidad. |
| `ratingAverage` | Media de las puntuaciones que ha **recibido**, redondeada a un decimal (`4.33` → `4.3`, `4.67` → `4.7`). `null` si no ha recibido ninguna; nunca `0`. |
| `ratingCount` | Número de valoraciones recibidas. Las que ella ha dado no cuentan. |
| `exchangeCount` | Intercambios `confirmed` o `rated` en los que participa, como proponente o como autora de la card. No cuentan `proposed`, `accepted`, `done`, `cancelled` ni `rejected`. |
| `createdAt` | Fecha de registro en barrio, ISO 8601 en UTC. Sirve para mostrar la antigüedad ("en barrio desde…"). En la base de datos es la columna `User.registeredAt`. |

No hay más campos: ni email, ni `firebaseUid`, ni comentarios, ni saldo.

**Cálculo:** la media no se guarda en ninguna parte. Se calcula al leer (`AVG` sobre las valoraciones), igual que el saldo se calcula a partir de las transacciones, así que refleja enseguida una valoración nueva.

**Errores propios:**

| Status | `error` | Cuándo |
|---|---|---|
| 404 | `Usuario no encontrado` | No existe ninguna usuaria con ese `id` (también si no tiene formato de UUID). |

Además de los comunes: `401` sin token y `404 Usuario no registrado` si quien pregunta no está registrada.

**`/me` no es un id:** la ruta del perfil está registrada después de `/me`, así que `GET /api/users/me` nunca se interpreta como el perfil de una usuaria con id `me`. Desde la tarjeta 15, `GET /api/users/me` devuelve mi perfil con esta misma forma, y hay también `PATCH /api/users/me`: ver [`profile-api-contract.md`](./profile-api-contract.md).

## Cambios en `POST /api/users/me`

Devuelve la usuaria completa, como antes, pero **sin el campo `rating`**: esa columna se ha eliminado, porque la media se calcula ahora en el perfil público. No había ningún consumidor que lo leyera.

## Cambios en las respuestas de cards

Afecta a todas las rutas que devuelven una card: `GET /api/cards`, `GET /api/cards/:id`, `POST /api/cards` y `PATCH /api/cards/:id`.

- **`author`** pasa a ser solo `{ "id", "name", "avatar" }` (`avatar` es `""` si no tiene). Ya no incluye `email` ni `firebaseUid`: ninguna respuesta de cards los contiene, ni en `author` ni en ningún otro sitio del JSON.
- **`isMine`** (nuevo, `boolean`): `true` si la card es de quien hace la petición. Sustituye a comparar `author.firebaseUid` con el uid de la sesión en el frontend.
- **`POST /api/cards`** ahora también incluye `author` e `isMine` (siempre `true`); antes devolvía la card sin `author`.
- **Permisos:** no cambian. Editar y borrar siguen comprobándose en el servidor contra la base de datos (`403` si no eres la autora). `isMine` sirve solo para pintar la interfaz.

```json
{
  "id": "a7b8c9d0-1e2f-4a3b-8c4d-5e6f7a8b9c0d",
  "authorId": "0d9c8b7a-6f5e-4d3c-2b1a-0f9e8d7c6b5a",
  "author": { "id": "0d9c8b7a-6f5e-4d3c-2b1a-0f9e8d7c6b5a", "name": "Ana", "avatar": "" },
  "isMine": false,
  "type": "request",
  "title": "Regar plantas",
  "…": "el resto de campos de la card, sin cambios"
}
```

Para el bloque de la autora (valoración media, intercambios, antigüedad), pide `GET /api/users/:id` con `author.id`.

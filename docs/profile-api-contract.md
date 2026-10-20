# Contrato de la API del perfil propio y el historial de créditos (tarjeta 15)

Comportamiento real de `barrio-backend` tras la tarjeta 15 (perfil, rama `feature/profile`). Salvo donde pone *(sin test)*, cada afirmación está cubierta por un test en `src/routes/users.test.ts` o `src/routes/wallet.test.ts`.

El perfil público de otra persona (`GET /api/users/:id`) está en [`ratings-api-contract.md`](./ratings-api-contract.md#get-apiusersid-perfil-público-mínimo). El perfil propio tiene exactamente la misma forma.

## Convenciones comunes

- **Autenticación:** todas las rutas exigen `Authorization: Bearer <idToken de Firebase>`.
- **Fechas, formato de errores y errores comunes** (401, `400 invalid_request`, `500 internal_error`): los mismos que en el [contrato del chat](./chat-api-contract.md#convenciones-comunes).
- **Privacidad:** ninguna respuesta incluye email, `firebaseUid` ni `welcomeCreditGrantedAt`, ni de quien pregunta ni de otras personas.
- **Saldo:** no está en el perfil. Sigue saliendo de `GET /api/wallet/balance` (`{ balance, reserved, available }`), que no cambia.

## `GET /api/users/me`: mi perfil

**Petición:** sin cuerpo.

**Respuesta `200`:** la misma forma que el perfil público, con los datos de quien pregunta. El frontend puede usar un solo tipo (`PublicProfile`) para los dos.

```json
{
  "id": "0d9c8b7a-6f5e-4d3c-2b1a-0f9e8d7c6b5a",
  "name": "Mercè",
  "avatar": "🌻",
  "verified": false,
  "ratingAverage": 4.5,
  "ratingCount": 2,
  "exchangeCount": 3,
  "createdAt": "2026-09-29T15:27:03.000Z"
}
```

El significado de cada campo está en la [tabla del perfil público](./ratings-api-contract.md#get-apiusersid-perfil-público-mínimo). En resumen:

- `ratingAverage` es `null` sin valoraciones, nunca `0`.
- `verified` es `true` con la identidad verificada; es lo que pinta la insignia "Identidad verificada".
- `avatar` es `""` si no hay avatar; el frontend pinta entonces la inicial del nombre.

**Cambio respecto a antes:** hasta la tarjeta 15 esta ruta devolvía solo `{ "name": "…" }`. `name` sigue estando, en el mismo sitio, así que quien solo leía `name` no se rompe.

**Errores propios:**

| Status | `error` | Cuándo |
|---|---|---|
| 404 | `Usuario no encontrado` | El token es válido, pero esa usuaria no está registrada en la base de datos. Ojo: el texto no es el mismo que en el resto de rutas (`Usuario no registrado`), porque se mantiene el que esta ruta ya tenía. |

## `PATCH /api/users/me`: editar mi nombre y mi avatar

**Petición:** al menos uno de los dos campos.

```json
{ "name": "Mercè Puig", "avatar": "🌻" }
```

- **`name`** (opcional): texto. Se recortan los espacios del principio y del final. Tras recortar debe tener entre 1 y 80 caracteres: solo espacios cuenta como vacío y exactamente 80 es válido. Se modera antes de guardarlo, igual que el texto de una card.
- **`avatar`** (opcional): uno de los avatares de la lista de abajo, o `""` para quitar el avatar. No se modera.
- **Otros campos** (`email`, `verified`, `firebaseUid`…): se ignoran. No se pueden cambiar por esta ruta.
- **Todo o nada:** si cualquiera de los dos campos es inválido, o el nombre no pasa la moderación, no se guarda ninguno.

**Respuesta `200`:** mi perfil ya actualizado, con la misma forma que `GET /api/users/me`.

**El nombre no está copiado en ningún sitio.** Cards y chats lo leen de la usuaria en cada petición, así que el nombre nuevo sale enseguida en `author.name` de `GET /api/cards` y `GET /api/cards/:id`, y en `other.name` de `GET /api/exchanges` y `GET /api/exchanges/:id` para la otra persona. Lo mismo vale para el avatar *(sin test el avatar en cards y chats; el nombre sí)*.

### Avatares disponibles

Lista cerrada, definida en `src/config/avatars.ts` (`AVATARS`). No hay subida de ficheros ni URLs.

```
🐈 🐕 🌿 🌻 🎸 🔧 📚 🍳 🚲 🏡 ☕ 🧶
```

- **Comparación exacta:** cada avatar es un único carácter Unicode, sin selector de variante. El frontend debe enviar el valor tal como está en la lista. Un `☕️` con `U+FE0F` (lo que añaden algunos teclados) se rechaza *(sin test este caso; sí el de espacios alrededor)*.
- **`""`:** sin avatar.

### Orden de comprobación

401 → 404 → 400 → 422 / 500. Primero se comprueba que la usuaria existe, después el cuerpo y por último se modera el nombre. Si el cuerpo es inválido no se llama al clasificador. Si solo cambia el avatar, tampoco.

| Status | `error` | Cuándo |
|---|---|---|
| 404 | `Usuario no registrado` | El token es válido, pero esa usuaria no está registrada. Se responde así sea cual sea el cuerpo. |
| 400 | `Envía name o avatar` | El cuerpo no trae ni `name` ni `avatar` (aunque traiga otros campos). |
| 400 | `name es obligatorio y debe ser un texto` | `name` viene, pero no es una cadena o queda vacío al recortar. |
| 400 | `name debe tener 80 caracteres como máximo` | `name` tiene más de 80 caracteres tras recortar. |
| 400 | `avatar debe ser uno de: 🐈, 🐕, 🌿, 🌻, 🎸, 🔧, 📚, 🍳, 🚲, 🏡, ☕, 🧶 o "" para no tener avatar` | `avatar` viene y no es uno de la lista ni `""` (otro emoji, una URL, un número, `null`, el emoji con espacios…). |
| 422 | `content_rejected` | El nombre no pasa la moderación. Puede traer `message` con el motivo legible (los filtros fijos, como teléfonos o emails, lo traen; el clasificador de IA no). |
| 500 | `moderation_failed` | El clasificador ha fallado. No se guarda nada; se puede reintentar. |

## `GET /api/wallet/transactions`: historial de créditos

Mis movimientos de horas, como pagadora o como receptora, para la pantalla de perfil. El saldo no cambia de sitio: sigue en `GET /api/wallet/balance`.

**Petición:** sin cuerpo.

**Respuesta `200`:**

```json
{
  "items": [
    {
      "id": "3e4f5a6b-7c8d-4e9f-a0b1-c2d3e4f5a6b7",
      "kind": "exchange",
      "direction": "in",
      "hours": 2,
      "date": "2026-10-12T10:30:00.000Z",
      "exchangeId": "6f1c2a8e-3b4d-4c5e-9f60-1a2b3c4d5e6f",
      "card": { "id": "a7b8c9d0-1e2f-4a3b-8c4d-5e6f7a8b9c0d", "title": "Clases de guitarra", "type": "offer", "category": "learning" },
      "other": { "id": "0d9c8b7a-6f5e-4d3c-2b1a-0f9e8d7c6b5a", "name": "Javi", "avatar": "" }
    },
    {
      "id": "9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d",
      "kind": "welcome",
      "direction": "in",
      "hours": 2,
      "date": "2026-09-29T15:27:03.000Z",
      "exchangeId": null,
      "card": null,
      "other": null
    }
  ]
}
```

Sin movimientos, `{ "items": [] }`.

| Campo | Significado |
|---|---|
| `id` | Id del movimiento. |
| `kind` | `welcome` para el regalo de bienvenida (el único movimiento sin intercambio); `exchange` para el pago de un intercambio confirmado. |
| `direction` | `in` si las horas son para quien pregunta; `out` si salen de quien pregunta. |
| `hours` | Horas del movimiento, siempre en positivo. El signo lo pone el frontend según `direction`. |
| `date` | Cuándo se movieron las horas. |
| `exchangeId` | El intercambio que lo originó, o `null` en `welcome`. |
| `card` | `id`, `title`, `type` y `category` de la card del intercambio, o `null` en `welcome`. Sale también si la card está borrada. |
| `other` | La otra persona: quien pagó si es `in`, quien cobró si es `out`. Solo `id`, `name` y `avatar`. `null` en `welcome`. |

- **Orden:** `date` de más reciente a más antigua. Con la misma `date`, por `id` ascendente, así que el orden es siempre el mismo.
- **Solo lo mío:** nunca aparecen movimientos entre otras personas.
- **Las dos caras:** el mismo pago sale como `in` para quien cobra y como `out` para quien paga, con la otra persona en `other`.
- **Limitación: como mucho 100 movimientos,** los más recientes. No hay paginación todavía; si hay más, los más antiguos no salen.
- **Las reservas no aparecen:** las horas reservadas por un intercambio `accepted` o `done` no son un movimiento, se ven solo en `reserved` de `GET /api/wallet/balance` *(sin test)*.

**Errores propios:**

| Status | `error` | Cuándo |
|---|---|---|
| 404 | `Usuario no registrado` | El token es válido, pero esa usuaria no está registrada. |

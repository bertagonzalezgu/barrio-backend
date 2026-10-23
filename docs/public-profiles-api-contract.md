# Contrato de la API de perfiles públicos, intereses y valoraciones públicas

Comportamiento real de `barrio-backend` tras la rama `feature/reviews-public-profiles`. Todo es **aditivo** sobre los contratos de [valoraciones](./ratings-api-contract.md) y de [perfil](./profile-api-contract.md), salvo dos cambios marcados como **⚠ cambio**. Cada afirmación está cubierta por un test en `src/routes/users.test.ts`, `src/routes/userLists.test.ts`, `src/routes/ratings.test.ts` o `src/routes/cards.test.ts`.

## Convenciones comunes

- **Autenticación:** todas las rutas exigen `Authorization: Bearer <idToken de Firebase>`. Sin token: `401`.
- **Fechas y formato de errores:** los mismos que en el [contrato del chat](./chat-api-contract.md#convenciones-comunes).
- **Categorías:** los valores del enum `CardCategory`, los mismos que usan las cards: `home_repairs`, `cleaning`, `moving`, `garden`, `peoplecare`, `petcare`, `health_support`, `learning`, `workshops`, `digital`, `cooking`, `transport`, `events`, `sports`, `creative_projects`.
- **Privacidad:** ninguna respuesta incluye email, `firebaseUid` ni ubicación. Los usuarios no tienen ubicación propia; solo las cards tienen `lat`/`lng`.
- **Moderación:** el texto libre que se publica (nombre, bio, comentario de una valoración) pasa por el mismo filtro que las cards: primero la blocklist y después la IA. Si se rechaza, la respuesta es `422 { "error": "content_rejected", "message"? }`. Si el clasificador falla, es `500 { "error": "moderation_failed" }`. En los dos casos no se guarda nada.

### Paginación

`GET /api/users/:id/cards` y `GET /api/users/:id/reviews` aceptan:

| Query | Por defecto | Valores válidos |
|---|---|---|
| `page` | `1` | Entero ≥ 1. Una página más allá del final devuelve `items: []`. |
| `pageSize` | `20` | Entero entre 1 y 50. |

Si no es válido: `400 page debe ser un entero mayor que 0` o `400 pageSize debe ser un entero entre 1 y 50`.

Respuesta: `{ "items": [...], "page": 1, "pageSize": 20, "total": 42 }`. `total` es el número total de elementos, sea cual sea la página.

## Perfil: campos nuevos

### `GET /api/users/:id`: añade `interests`, `offers` y `bio`

```json
{
  "id": "0d9c8b7a-…",
  "name": "Ana",
  "avatar": "avatar-03",
  "verified": true,
  "ratingAverage": 4.8,
  "ratingCount": 5,
  "exchangeCount": 7,
  "createdAt": "2026-09-29T15:27:03.000Z",
  "interests": ["garden", "cooking"],
  "offers": ["digital"],
  "bio": "Vecina de Gràcia, me encantan las plantas."
}
```

| Campo | Significado |
|---|---|
| `interests` | Categorías que le interesan. `[]` si no ha elegido ninguna. |
| `offers` | Categorías en las que podría ayudar. `[]` si no ha elegido ninguna. |
| `bio` | Texto libre de hasta 280 caracteres, o `null`. |

Los nombres que ya existían **no cambian**: `ratingAverage`, `ratingCount`, `exchangeCount` y `createdAt`.

### `GET /api/users/me`: lo mismo, más `onboardingCompletedAt`

Es la misma forma que el perfil público, más **`onboardingCompletedAt`**: la fecha ISO en que completé el onboarding, o `null` si no lo he hecho. Este campo solo lo ve la propia persona; `GET /api/users/:id` no lo devuelve. En el frontend: `interface OwnProfile extends PublicProfile { onboardingCompletedAt: string | null }`.

### `PATCH /api/users/me`: campos editables nuevos

```json
{ "interests": ["garden"], "offers": ["cooking", "digital"], "bio": "Hola", "onboardingCompleted": true }
```

Todos son opcionales. Basta con enviar uno, y se pueden combinar con `name` y `avatar`. Si un campo falla, no se guarda ninguno.

| Campo | Reglas |
|---|---|
| `interests`, `offers` | Lista (puede ser `[]`) de valores de `CardCategory`, sin repetir y con 15 como máximo. Se rechaza un texto suelto, `null`, mayúsculas o una categoría inventada. Reemplazan la lista entera. No se moderan. |
| `bio` | Texto de hasta 280 caracteres después de recortar espacios. `""` o solo espacios **borra** la bio (pasa a `null`). Si se envía `null` o un número, da 400. Se modera junto al `name` en una sola llamada: `"<name> <bio>"`. |
| `onboardingCompleted` | Solo admite `true`. La fecha la pone el servidor la **primera** vez; enviarlo de nuevo no la cambia. No hay forma de deshacerlo. |

**Respuesta `200`:** mi perfil actualizado, con la forma de `GET /api/users/me` (incluye `onboardingCompletedAt`).

**Orden:** 401 → 404 `Usuario no registrado` → 400 → 422/500 de moderación.

| Status | `error` |
|---|---|
| 400 | `Envía al menos uno de: name, avatar, bio, interests, offers, onboardingCompleted` **⚠ cambio:** antes el texto era `Envía name o avatar`. |
| 400 | `interests debe ser una lista de categorías: home_repairs, …` (igual con `offers`) |
| 400 | `interests puede tener 15 categorías como máximo` |
| 400 | `interests no puede tener categorías repetidas` |
| 400 | `bio debe ser un texto` · `bio debe tener 280 caracteres como máximo` |
| 400 | `onboardingCompleted solo admite true` |

## `GET /api/users/:id/cards`: cards activas de una persona

Devuelve solo las cards `active` de esa persona, de la más nueva a la más antigua y paginadas. No incluye las `completed`, `reported` ni `deleted`. Cada elemento tiene exactamente el mismo formato que una card de `GET /api/cards`: `author` mínimo `{ id, name, avatar }` e `isMine`.

```json
{ "items": [{ "id": "…", "title": "Regar plantas", "author": { "id": "…", "name": "Ana", "avatar": "" }, "isMine": false, "…": "…" }], "page": 1, "pageSize": 20, "total": 1 }
```

## `GET /api/users/:id/reviews`: valoraciones recibidas

Devuelve las valoraciones que ha **recibido** esa persona, de la más nueva a la más antigua y paginadas.

```json
{
  "items": [
    {
      "id": "…",
      "score": 5,
      "comment": "Muy puntual",
      "createdAt": "2026-10-20T09:12:00.000Z",
      "author": { "name": "Carlos P.", "avatar": "avatar-02" }
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 1
}
```

- **`author.name`** se abrevia: el primer nombre y la inicial de la segunda palabra, en mayúscula (`"Carlos Pérez García"` → `"Carlos P."`). Si el nombre es una sola palabra, sale tal cual.
- **No incluye el id de quien valora:** con él se podría abrir su perfil y ver el nombre completo, que es precisamente lo que se abrevia.
- **`comment`** solo aparece si pasó moderación. Los comentarios guardados antes de esta rama, cuando eran privados y no se moderaban, salen como `null`.

Errores de las dos rutas de listado: **orden 401 → 404 `Usuario no registrado` → 400 de paginación → 404 `Usuario no encontrado`** (el `:id` no existe, aunque no tenga formato de UUID).

## Valorar: `POST /api/exchanges/:id/rating` ahora modera el comentario

La ruta, el cuerpo, la respuesta y la máquina de estados (`confirmed` → `rated` cuando han valorado las dos) **no cambian**. **⚠ cambio:** el `comment` deja de ser privado y ahora se modera:

- **Nuevo orden:** 401 → 404 → 400 → 409 → **422/500 de moderación**. Una tercera persona, una valoración repetida o un intercambio sin confirmar se rechazan **antes** de llamar a la IA.
- Sin comentario (o con uno vacío) no se modera nada.
- Si el comentario se rechaza, no se guarda la valoración (tampoco la puntuación). La persona puede volver a intentarlo con otro texto.

No existe `POST /exchanges/:id/reviews`: la valoración ya existía como `/rating`, con el modelo `Rating`.

## `GET /api/cards/:id`: resumen de confianza del autor

Solo en el **detalle** (no en el listado, ni en `POST` o `PATCH`), `author` añade el resumen de confianza:

```json
"author": { "id": "…", "name": "Ana", "avatar": "", "verified": true, "ratingAverage": 4.8, "ratingCount": 5, "exchangeCount": 7 }
```

Los valores son los mismos que en `GET /api/users/:id`, así que el bloque de la autora ya no necesita una segunda petición.

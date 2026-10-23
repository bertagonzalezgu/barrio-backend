# Contrato de la API del mapa y de la ubicación de las cards (tarjeta 16)

Comportamiento real de `barrio-backend` tras la tarjeta 16 (mapa, rama `feature/map`). Cada afirmación sobre el comportamiento está cubierta por un test en `src/routes/map.test.ts`, `src/routes/cards.test.ts`, `src/routes/userLists.test.ts` o `src/services/coordinates.test.ts`.

## Convenciones comunes

- **Autenticación:** todas las rutas exigen `Authorization: Bearer <idToken de Firebase>`. Sin token: `401`.
- **Fechas y formato de errores:** los mismos que en el [contrato del chat](./chat-api-contract.md#convenciones-comunes).
- **Categorías:** los valores del enum `CardCategory`, con guion bajo: `home_repairs`, `cleaning`, `moving`, `garden`, `peoplecare`, `petcare`, `health_support`, `learning`, `workshops`, `digital`, `cooking`, `transport`, `events`, `sports`, `creative_projects`.
- **Privacidad:** la ubicación exacta de una card solo la ve su autora. El resto, también en el mapa, recibe una **ubicación aproximada** (ver [Aproximación](#aproximación)).

## Aproximación

`lat` y `lng` se redondean por separado a **3 decimales**. En un empate, el redondeo se aleja del cero, también en negativos (`0.0625` → `0.063`, `-0.0625` → `-0.063`).

- En Barcelona, 3 decimales son una celda de unos **110 m (lat) × 83 m (lng)**. La ubicación aproximada dice en qué zona está la card, no en qué portal. (0,001° de latitud son unos 111 m en todo el planeta; de longitud, a la latitud de Barcelona, unos 83 m.)
- Varias cards cercanas pueden caer en **la misma celda** y devolver exactamente las mismas coordenadas. Sus pins se superpondrían.
- La precisión es una constante (`COORDINATE_DECIMALS` en `src/services/coordinates.ts`). Si cambia, cambian a la vez el mapa y el resto de respuestas.

## `GET /api/cards/map`: cards para pintar en el mapa

Devuelve las cards `active` que tienen `lat` y `lng`, de la más nueva a la más antigua. No incluye las `completed`, `reported` ni `deleted`, ni las que no tienen ubicación. No está paginada y no filtra por zona: devuelve todas.

**Query (opcional):**

| Query | Valores válidos |
|---|---|
| `category` | Un valor de `CardCategory`. |
| `type` | `request` u `offer`. |

Se pueden combinar. Son los mismos filtros que `GET /api/cards`, con las mismas validaciones y los mismos mensajes de error.

**Respuesta `200`:** una lista, `[]` si no hay ninguna.

```json
[
  {
    "id": "a7b8c9d0-1e2f-4a3b-8c4d-5e6f7a8b9c0d",
    "type": "offer",
    "category": "home_repairs",
    "title": "Arreglo grifos",
    "icon": "home-repairs-wrench",
    "hours": 2,
    "lat": 41.385,
    "lng": 2.174
  }
]
```

| Campo | Significado |
|---|---|
| `id` | Id de la card. Con él se pide el detalle a `GET /api/cards/:id`. |
| `type`, `category`, `title`, `icon`, `hours` | Los mismos valores que en `GET /api/cards`. `icon` es `""` si no tiene. |
| `lat`, `lng` | **Siempre aproximados**, también en las cards propias: el mapa se pinta igual para todo el mundo. Nunca son `null`. |

**Lo que no incluye:** `description`, `authorId`, `author`, `isMine`, `status`, fechas ni ninguna otra cosa. Para eso está el detalle.

**Errores:**

| Status | `error` |
|---|---|
| 401 | `Token no proporcionado` (sin cabecera `Authorization`) · `Token inválido o expirado` (Firebase rechaza el token) |
| 400 | `La categoría debe ser una de: home_repairs, …` (la lista completa del enum) |
| 400 | `El tipo debe ser uno de: request, offer` |

Igual que `GET /api/cards`, no comprueba que quien pregunta esté registrada: un token válido basta.

## Ubicación en las demás respuestas de cards

**⚠ cambio:** hasta ahora `lat` y `lng` salían exactos para cualquier persona autenticada. Ahora:

| Ruta | Autora (`isMine: true`) | Otra persona (`isMine: false`) |
|---|---|---|
| `GET /api/cards` | Exactos | Aproximados |
| `GET /api/cards/:id` | Exactos | Aproximados |
| `GET /api/users/:id/cards` | Exactos | Aproximados |
| `POST /api/cards`, `PATCH /api/cards/:id` | Exactos (solo los hace la autora) | — |

- Una card sin ubicación devuelve `lat: null` y `lng: null` para todo el mundo.
- El nombre y el tipo de los campos no cambian. Solo cambia la precisión.
- Para editar una card propia, el formulario puede usar `GET /api/cards/:id`, que a la autora le devuelve la ubicación exacta.
- **Todavía no implementado:** compartir la ubicación exacta con la otra persona cuando se acepta un intercambio. Hoy la ubicación exacta solo la ve la autora, también durante un intercambio.

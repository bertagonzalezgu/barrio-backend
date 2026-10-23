# Contrato de la API del calendario (tarjeta 17)

Comportamiento real de `barrio-backend` tras la tarjeta 17 (calendario, rama `feature/calendar`). Cada afirmación sobre el comportamiento está cubierta por un test en `src/routes/calendar.test.ts`, salvo las que remiten a otro contrato.

## Convenciones comunes

- **Autenticación:** la ruta exige `Authorization: Bearer <idToken de Firebase>`. Sin token: `401`.
- **Formato de errores:** el mismo que en el [contrato del chat](./chat-api-contract.md#convenciones-comunes).
- **Categorías:** los valores del enum `CardCategory`, los mismos que en el [contrato del mapa](./map-api-contract.md#convenciones-comunes).

## Fechas de una card

- `startDate` y `endDate` son **días de calendario**: la base de datos no guarda la hora. Salen como cadena ISO 8601 a medianoche UTC: `"2026-11-02T00:00:00.000Z"`. Para pintarlas, lee solo la parte `YYYY-MM-DD`. Si conviertes la cadena entera a la hora local, en husos al oeste de UTC el día puede quedar en el anterior.
- `endDate` es **inclusiva**: una card de 4 días que empieza el 2 de noviembre tiene `startDate: "2026-11-02T00:00:00.000Z"` y `endDate: "2026-11-05T00:00:00.000Z"`. Una card de un solo día tiene `startDate` igual a `endDate`.
- Las dos van juntas: una card tiene las dos fechas o ninguna. El servidor calcula `endDate` a partir de `startDate` y `durationDays` (ver `POST /api/cards` y `PATCH /api/cards/:id`).

## `GET /api/cards/calendar`: cards con fechas para el calendario

Devuelve las cards `active` que tienen `startDate` y `endDate`, **de cualquier autora** (no solo las de quien pregunta). No incluye las `completed`, `reported` ni `deleted`, ni las que no tienen fechas. Una card sin ubicación sí sale si tiene fechas.

- **Orden:** por `startDate` ascendente. En un empate (varias cards que empiezan el mismo día), por `id` ascendente. El orden es el mismo en cada petición.
- **Sin paginación y sin filtro de fechas:** devuelve todas, también las que ya han terminado.

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
    "authorId": "3c1d2e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    "type": "request",
    "title": "Regar plantas en agosto",
    "description": "Me voy dos semanas y el balcón no sobrevive solo.",
    "category": "garden",
    "hours": 2,
    "icon": "garden-plant",
    "startDate": "2026-11-02T00:00:00.000Z",
    "endDate": "2026-11-15T00:00:00.000Z",
    "status": "active",
    "createdAt": "2026-10-20T09:12:44.000Z",
    "updatedAt": "2026-10-20T09:12:44.000Z",
    "author": { "id": "3c1d2e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", "name": "Jordi", "avatar": "avatar-03" },
    "isMine": false
  }
]
```

| Campo | Significado |
|---|---|
| Todos menos `lat` y `lng` | Los mismos que devuelve `GET /api/cards`, con los mismos valores. `status` siempre es `active`. |
| `startDate`, `endDate` | Ver [Fechas de una card](#fechas-de-una-card). Nunca son `null`. |
| `isMine` | `true` si la card es de quien pregunta. |

**Lo que no incluye:** `lat` ni `lng`, tampoco en las cards propias. El calendario no los necesita. La ubicación está en `GET /api/cards/:id` o en el mapa.

**Errores:**

| Status | `error` |
|---|---|
| 401 | `Token no proporcionado` (sin cabecera `Authorization`) · `Token inválido o expirado` (Firebase rechaza el token; mismo middleware que el resto, ver el [contrato del mapa](./map-api-contract.md)) |
| 400 | `La categoría debe ser una de: home_repairs, …` (la lista completa del enum) |
| 400 | `El tipo debe ser uno de: request, offer` |

Igual que `GET /api/cards`, no comprueba que quien pregunta esté registrada: un token válido basta.

## Ampliaciones posibles (no implementadas)

- **Filtro por rango (`from`, `to`):** devolvería las cards que se **solapan** con el rango, no solo las que empiezan dentro: `startDate <= to AND endDate >= from`. Así, una card del 30 de octubre al 3 de noviembre aparece al pedir noviembre. Haría falta cuando el volumen de cards haga pesado devolverlas todas.
- **Paginación:** igual que el filtro, solo si crece el volumen.

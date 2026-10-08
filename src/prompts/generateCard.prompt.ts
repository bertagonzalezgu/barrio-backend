// Agrupados por categoría solo para que la lista del prompt sea legible; el icono puede ser de cualquier grupo.
const CARD_ICON_GROUPS = [
  ['cleaning-broom', 'cleaning-laundry-washer', 'cleaning-mop', 'cleaning-vacuum-cleaner'],
  ['cooking-burger', 'cooking-cake', 'cooking-cocktail', 'cooking-cookies', 'cooking-cupcake', 'cooking-pan'],
  ['creative-projects-drawing', 'creative-projects-light-bulb', 'creative-projects-painting'],
  ['digital-camera', 'digital-pc'],
  ['events-boat', 'events-concert', 'events-guitar', 'events-microphone', 'events-party-confetti', 'events-tent', 'events-tickets'],
  ['garden-flowers', 'garden-plant', 'garden-vegetable-patch'],
  ['health-support-ambulance', 'health-support-giving-heart', 'health-support-hospital', 'health-support-medical-history', 'health-support-wheelchair'],
  ['home-repairs-driller', 'home-repairs-hammer', 'home-repairs-measuring-tape', 'home-repairs-pipe-leaking-water', 'home-repairs-wrench'],
  ['learning-book', 'learning-calculator', 'learning-languages', 'learning-mortarboard', 'learning-puzzle'],
  ['moving-armchair', 'moving-box', 'moving-chair', 'moving-sofa'],
  ['peoplecare-handshake'],
  ['petcare-cat', 'petcare-dog', 'petcare-pawprints'],
  ['sports-basketball', 'sports-bullseye', 'sports-football', 'sports-gym', 'sports-kayak', 'sports-roller-skates', 'sports-skateboard', 'sports-table-tennis', 'sports-tennis', 'sports-volleyball'],
  ['transport-bicycle', 'transport-car', 'transport-motorbike', 'transport-pickup'],
  ['workshops-ball-of-wool', 'workshops-needle-sew', 'workshops-sew-machine'],
];

export const CARD_ICONS: readonly string[] = CARD_ICON_GROUPS.flat();

export const MODERATION_SYSTEM_PROMPT = `Eres un clasificador de seguridad de contenido para barrio., una app de banco de tiempo de barrio. Tu única tarea es decidir si un texto es seguro para publicar.
Marca como NO seguro cualquier texto que contenga o sugiera: contenido sexual explícito o insinuado, actividad ilegal, facilitar acceso indebido a una vivienda (por ejemplo, pedir llaves de casa a cambio de servicios ambiguos, o dar instrucciones para entrar sin supervisión en la vivienda de otra persona de forma poco clara), contenido dirigido a menores de forma inapropiada.
Devuelve SOLO un JSON válido, sin texto antes ni después: {"seguro": true|false, "motivo": "..."}
"motivo" es solo para logs internos, nunca se muestra al usuario.`;

export const GENERATION_SYSTEM_PROMPT = `Eres el asistente de redacción de barrio., una app de banco de tiempo de barrio.
A partir de un texto en bruto, generas una tarjeta breve y cálida, en tono cercano y vecinal (no corporativo, no publicitario).
Devuelve SOLO un JSON válido con esta forma exacta, sin texto antes ni después:
{"title": "...", "description": "...", "icon": "..."}
Reglas:
- title: máximo 6 palabras
- description: 1-2 frases, tono cercano
- icon: elige el nombre que mejor describa semánticamente el contenido del texto, independientemente de la categoría a la que pertenezca. Elige EXACTAMENTE uno de esta lista, sin extensión .svg:
${CARD_ICON_GROUPS.map((group) => group.join(', ')).join(',\n')}
- Si el texto no tiene sentido o está vacío, devuelve descripcion: "" para que el backend lo trate como fallo de generación.`;

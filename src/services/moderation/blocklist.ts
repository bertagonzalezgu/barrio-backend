/**
 * barrio-backend/src/services/moderation/blocklist.ts
 *
 * PRIMERA capa de moderación (barata, determinista, sin llamar a la IA).
 * La segunda capa sigue siendo el clasificador de la IA sobre el texto final.
 *
 * Idea clave: NO se enumeran variantes (vi0laci0n, v.i.o.l.a.c.i.o.n, VIOLAAACIÓN...).
 * Se normaliza el texto del usuario (norm) y se compara contra una sola forma
 * limpia de cada término. Los términos de abajo se escriben en español normal.
 *
 * Dos niveles:
 *  - BLOCK  → se rechaza la tarjeta (422 + message). Términos con muy poco uso legítimo.
 *  - REVIEW → NO se bloquea: son palabras ambiguas ("llaves", "niño", "inyección"...).
 *             Se pasan como `hints` al clasificador de la IA para que sea más estricto.
 *             Bloquearlas rompería casos de uso reales (cuidar a Nala, canguro, apoyo sanitario).
 *
 * Reglas de escritura de términos:
 *  - Frase = varias palabras ("hijo de puta"). Coincide con límites de palabra.
 *  - Termina en `*` = prefijo ("porn*" → porno, pornografía). Úsalo solo si es seguro
 *    ("viol*" NO: casaría con "violeta", y hay categoría Plantas).
 *  - RegExp = se aplica sobre el texto YA normalizado (sin tildes, ñ → ny, minúsculas).
 */

type Rule = { id: string; message: string; terms: (string | RegExp)[] };

/* ───────────────────────── NORMALIZACIÓN ───────────────────────── */

const CONFUSABLES: Record<string, string> = {
  // cirílico / griego que parece latino
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', у: 'y', і: 'i', ѕ: 's', к: 'k', м: 'm', н: 'h', т: 't', в: 'b',
  ο: 'o', α: 'a', ε: 'e', ι: 'i', ν: 'v', ρ: 'p',
};

const LEET: Record<string, string> = { '0': 'o', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's' };

/** `oneAs`: el "1" puede ser i ("v1olacion") o l ("1impieza"); se prueban las dos. */
export function norm(input: string, oneAs: 'i' | 'l' = 'i'): string {
  let s = input
    .replace(/[​-‏⁠-⁤﻿]/g, '') // caracteres invisibles
    .normalize('NFKC') // ｖｉｏｌａｃｉóｎ (ancho completo), ligaduras…
    .toLowerCase();
  s = s.replace(/./gu, (c) => CONFUSABLES[c] ?? c);
  s = s.replace(/ñ/g, 'ny'); // así "coño" ≠ "cono"
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); // quita tildes y diéresis
  // "v i o l a c i o n", "v.i.o.l.a.c.i.o.n", "v-i-o-l..." → "violacion"
  s = s.replace(
    /(?<![\p{L}\d@$])(?:[\p{L}\d@$][\s.\-_*]+){3,}[\p{L}\d@$](?![\p{L}\d@$])/gu,
    (m) => m.replace(/[\s.\-_*]+/g, ''),
  );
  // "v!olacion", "v|olacion" (solo dentro de una palabra: "puta!" se queda igual)
  s = s.replace(/(?<=\p{L})[!|](?=\p{L})/gu, 'i');
  // leetspeak solo en tokens que mezclan letras y cifras/símbolos ("vi0laci0n"); "3 días" no se toca
  s = s.replace(/[\p{L}\d@$]+/gu, (tok) => {
    if (!/\p{L}/u.test(tok) || !/[\d@$]/.test(tok)) return tok;
    return tok.replace(/[\d@$]/g, (c) => (c === '1' ? oneAs : (LEET[c] ?? c)));
  });
  s = s.replace(/k/g, 'c').replace(/b/g, 'v'); // kokaina/cocaina, biolacion/violacion
  s = s.replace(/(\p{L})\1+/gu, '$1'); // violaaaacion → violacion (los términos se normalizan igual)
  return s.replace(/\s+/g, ' ').trim();
}

/* ───────────────────────── PATRONES SOBRE TEXTO ORIGINAL ───────────────────────── */
// Cosas que tienen forma (teléfonos, emails, IBAN…) se detectan con regex, no con listas.

type RawPattern = { re: RegExp; severity: 'block' | 'review'; id: string; message: string };

const RAW_PATTERNS: RawPattern[] = [
  { re: /[€£]|\$\s?\d|\d\s?\$|\d\s?(?:eur\b|euros?\b)/i, severity: 'block', id: 'money', message: 'En barrio. se intercambia tiempo, no dinero.' },
  { re: /(?<!\d)(?:(?:\+|00)\s?34[\s.-]?)?[6-9](?:[\s.-]?\d){8}(?!\d)/, severity: 'block', id: 'external_contact', message: 'No compartas teléfonos ni contactos: usa el chat de barrio.' },
  { re: /(?<!\d)\+\d{2}[\s.-]?\d{6,12}/, severity: 'block', id: 'external_contact', message: 'No compartas teléfonos ni contactos: usa el chat de barrio.' },
  { re: /[\w.+-]+\s?(?:@|\(at\)|\[at\]|\barroba\b)\s?[\w-]+\s?(?:\.|\bpunto\b)\s?\w+/i, severity: 'block', id: 'external_contact', message: 'No compartas emails ni contactos: usa el chat de barrio.' },
  { re: /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]{2,}\.(?:com|net|org|cat|io|me|ly|gl|link)\b|\b(?:bit\.ly|t\.me|wa\.me|linktr\.ee)\b/i, severity: 'block', id: 'external_contact', message: 'No se permiten enlaces en las tarjetas.' },
  { re: /(?<![\w@])@[a-z0-9_.]{3,}/i, severity: 'block', id: 'external_contact', message: 'No compartas usuarios de redes: usa el chat de barrio.' },
  { re: /(?<![\p{L}\d])\d{8}[\s-]?[A-Za-z](?![\p{L}\d])/u, severity: 'block', id: 'personal_data', message: 'No compartas documentos de identidad.' },
  { re: /(?<![\p{L}\d])[XYZxyz][\s-]?\d{7}[\s-]?[A-Za-z](?![\p{L}\d])/u, severity: 'block', id: 'personal_data', message: 'No compartas documentos de identidad.' },
  { re: /(?<![\p{L}\d])[A-Za-z]{2}\d{2}(?:[\s-]?[A-Za-z0-9]{4}){3,7}(?:[\s-]?[A-Za-z0-9]{1,4})?(?![\p{L}\d])/u, severity: 'block', id: 'personal_data', message: 'No compartas datos bancarios.' },
  { re: /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/, severity: 'block', id: 'personal_data', message: 'No compartas datos bancarios.' },
  { re: /(?:\+\s?18|18\s?\+|\bsolo\s+adultos|\bmayores\s+de\s+18\b)/i, severity: 'block', id: 'sexual', message: 'barrio. no admite contenido para adultos.' },
  // edades de menores: "una niña de 12 años". Ruidoso ("15 años de experiencia") → solo REVIEW
  { re: /(?<!\d)(?:[5-9]|1[0-7])\s?a[ñn]os(?!\s+de\s+(?:experiencia|trabajo|profesi))/i, severity: 'review', id: 'minors', message: 'Edad de posible menor' },
  // dirección exacta: el mapa ya enseña una zona aproximada. Cambia a 'block' si quieres ser estricta.
  { re: /\b(?:calle|c\/|carrer|avenida|avda\.?|av\.|paseo|passeig|plaza|plaça|ronda|travesia)\s+[^\n,;]{2,40}?\s*(?:n[º°o.]?\s*)?\d{1,3}\b/i, severity: 'review', id: 'address', message: 'Dirección exacta' },
  // el texto acaba dentro de un prompt y luego en el DOM: marcado/JSON raro = sospechoso
  { re: /[<>{}]|```/, severity: 'review', id: 'markup', message: 'Marcado o código en el texto' },
];

/* ───────────────────────── BLOCK ───────────────────────── */

export const BLOCK_RULES: Rule[] = [
  {
    id: 'sexual',
    message: 'barrio. no admite contenido sexual ni propuestas de contacto íntimo.',
    terms: [
      // violencia sexual
      'violación', 'violaciones', 'violar', 'violarla', 'violarlo', 'violarte', 'violarme', 'violador', 'violadora', 'violó', 'violaron', 'violo',
      'abuso sexual', 'abusos sexuales', 'abusar de', 'abusador', 'abusadora', 'agresión sexual', 'agresiones sexuales',
      'acoso sexual', 'acosar', 'acosador', 'acosadora', 'manosear', 'tocamientos', 'tocarte', 'tocarla',
      // contenido sexual
      'sexo', 'sexos', 'sexual', 'sexuales', 'sexualidad', 'sexy', 'sexting', 'sexcam', 'porn*', 'xxx', 'erótico', 'erótica', 'eróticos', 'erotismo',
      'orgasmo', 'orgasmos', 'orgía', 'orgías', 'follar', 'follo', 'folla', 'follame', 'follarte', 'follarme', 'follamigos', 'amigos con derecho', 'amistad con derecho',
      'tetas', 'pezones', 'polla', 'pollas', 'pene', 'vagina', 'verga', 'pija', 'chocho', 'chupar la', 'mamada', 'mamadas', 'masturbar*', 'masturbación', 'eyacular', 'semen',
      'consolador', 'vibrador', 'fetiche', 'fetichismo', 'bdsm', 'dominatrix', 'sumisa', 'sumiso', 'swinger', 'swingers', 'pervertido', 'pervertida',
      // prostitución y similares
      'escort', 'escorts', 'prostituta', 'prostituto', 'prostitución', 'prostituirse', 'puticlub', 'burdel', 'putero', 'sugar daddy', 'sugar baby', 'sugar mommy',
      'onlyfans', 'only fans', 'camgirl', 'camboy', 'nudes', 'nude', 'fotos íntimas', 'fotos desnuda', 'fotos desnudo', 'contenido adulto', 'contenido para adultos',
      'final feliz', 'masaje erótico', 'masaje sensual', 'masaje con final feliz', 'masaje tántrico', 'happy ending',
      // catalán / inglés
      'violació', 'violacions', 'assetjament sexual', 'abús sexual', 'sexe', 'cony', 'rape', 'raped', 'rapist', 'porn', 'naked', 'hooker', 'blowjob', 'handjob', 'fuck', 'fucking', 'horny', 'milf',
    ],
  },
  {
    id: 'minors',
    message: 'Por seguridad, barrio. no permite este tipo de planteamientos con menores.',
    // Ojo: no se incluye jerga de códigos de abuso infantil; eso lo detecta mejor el clasificador de la IA.
    terms: [
      'pedofilia', 'pedófilo', 'pedofilo', 'pedófila', 'pederasta', 'pederastia', 'lolita', 'lolitas',
      'menor desnudo', 'menores desnudos', 'niños desnudos', 'niño desnudo', 'niña desnuda', 'niñas desnudas', 'fotos de niños', 'fotos de niñas', 'fotos de menores',
      'sexo con menores', 'sexo con niños', 'sexo con un menor', 'relación con un menor', 'relaciones con menores',
      'a solas con el niño', 'a solas con la niña', 'a solas con el menor', 'a solas con un niño', 'a solas con una niña', 'a solas con los niños',
      'dormir con el niño', 'dormir con la niña', 'duchar al niño', 'duchar a la niña', 'bañarme con el niño', 'bañarme con la niña',
    ],
  },
  {
    id: 'secrecy',
    message: 'En barrio. todo se habla con transparencia: no se permiten peticiones de secreto.',
    terms: [
      'nuestro secreto', 'entre tú y yo', 'solo entre nosotros', 'no se lo digas a nadie', 'no se lo cuentes a nadie', 'no le digas a nadie', 'que nadie se entere',
      'no se lo digas a tus padres', 'no se lo digas a tu madre', 'no se lo digas a tu padre', 'que no se enteren tus padres', 'sin que lo sepan tus padres', 'sin que se entere tu madre',
      'sin que lo sepa tu familia', 'borra los mensajes', 'borra el chat', 'borra esta conversación', 'no dejes rastro', 'sin dejar rastro', 'sin dejar huellas',
      'sin testigos', 'sin preguntas', 'sin hacer preguntas', 'no hagas preguntas', 'sin que nadie lo sepa', 'sin que se entere nadie', 'sin que lo sepa nadie',
      'sin que me vean', 'sin que te vean', 'discreción absoluta', 'máxima discreción', 'absoluta discreción', 'totalmente discreto',
    ],
  },
  {
    id: 'violence',
    message: 'No se permite contenido violento, amenazas ni armas.',
    terms: [
      'matar a', 'te voy a matar', 'voy a matar', 'te mato', 'os mato', 'los mato', 'te mataré', 'matarte', 'asesinar', 'asesinato', 'asesino', 'asesina', 'apuñalar', 'acuchillar',
      'estrangular', 'ahorcar', 'torturar', 'tortura', 'torturas', 'secuestrar', 'secuestro', 'secuestrador', 'raptar', 'rapto',
      'amenazar', 'amenaza', 'amenazas', 'amenazo', 'extorsionar', 'extorsión', 'chantajear', 'chantaje', 'paliza', 'palizas', 'linchar', 'linchamiento',
      'sicario', 'sicarios', 'ajuste de cuentas', 'tiroteo', 'tiroteos', 'atentado', 'atentados', 'explosivo', 'explosivos', 'dinamita', 'granada', 'granadas',
      'metralleta', 'fusil', 'rifle', 'escopeta', 'revólver', 'munición', 'municiones', 'arma', 'armas', 'arma blanca', 'arma de fuego', 'armas de fuego', 'katana', 'puñal', 'puñales',
      'táser', 'taser', 'pistola eléctrica', 'golpear a', 'agredir', 'agredirle', 'hacer daño a', 'hacerle daño a', 'hacerte daño', 'dar una lección', 'darle un escarmiento', 'escarmiento',
      'vengarme', 'venganza', 'vengarse', 'hacer desaparecer', 'que desaparezca', 'quitarlo de en medio', 'quitar de en medio',
      'incendiar', 'prender fuego', 'quemar la casa', 'quemar el coche', 'quemar el local',
      // catalán / inglés
      'assassinar', 'assassinat', 'assassí', 'segrestar', 'segrest', 'pallissa', 'armes', 'kill', 'murder', 'shoot', 'bomb', 'weapon', 'weapons',
    ],
  },
  {
    id: 'terror_hate',
    message: 'No se permite contenido de odio ni extremismo.',
    terms: [
      'nazi', 'nazis', 'neonazi', 'hitler', 'heil', 'sieg heil', 'supremacía blanca', 'supremacista', 'ku klux klan', 'kkk', 'yihad', 'yihadista', 'isis', 'daesh',
      'terrorista', 'terrorismo', 'antisemita', 'raza superior', 'limpieza étnica',
      /\b(?:moros?|negros?|gitanos?|judios?|chinos?|latinos?|sudacas?|inmigrantes?|extranjeros?|musulmanes?|gays?|trans|lesbianas?|mujeres|hombres) de mierda\b/,
    ],
  },
  {
    id: 'discrimination',
    message: 'barrio. es para todo el mundo: no se permiten condiciones discriminatorias.',
    terms: [
      'no se admiten extranjeros', 'no extranjeros', 'sin extranjeros', 'sin inmigrantes', 'no inmigrantes', 'solo españoles', 'solo españolas', 'solo blancos', 'solo gente blanca', 'solo nacionales',
      'no musulmanes', 'sin musulmanes', 'no gitanos', 'sin gitanos', 'no negros', 'sin negros', 'sin moros', 'no moros', 'no gays', 'sin gays', 'no homosexuales', 'no trans',
    ],
  },
  {
    id: 'insults',
    message: 'Cuida el lenguaje: en barrio. nos tratamos con respeto.',
    terms: [
      'hijo de puta', 'hija de puta', 'hijoputa', 'hijueputa', 'hdp', 'puta', 'putas', 'puto', 'putos', 'putón', 'zorra', 'zorras', 'guarra', 'guarro',
      'subnormal', 'subnormales', 'retrasado', 'retrasada', 'mongolo', 'mongola', 'mongólico', 'gilipollas', 'gilipuertas', 'imbécil', 'imbéciles',
      'maricón', 'maricones', 'marica', 'maricas', 'bollera', 'bolleras', 'travelo', 'travelos', 'sudaca', 'sudacas', 'panchito', 'negrata', 'negratas', 'nigger', 'nigga',
      // catalán
      'fill de puta', 'filla de puta', 'putes', 'malparit', 'gilipolles', 'merdós',
    ],
  },
  {
    id: 'drugs',
    message: 'No se permite contenido sobre drogas.',
    terms: [
      'droga', 'drogas', 'drogar*', 'drogado', 'drogadicto', 'narcotráfico', 'narco', 'narcos', 'traficar', 'traficante', 'trapicheo', 'trapichear', 'camello',
      'cocaína', 'perico', 'farlopa', 'heroína', 'marihuana', 'porro', 'porros', 'canuto', 'hachís', 'cogollos', 'grow shop', 'growshop', 'weed',
      'lsd', 'éxtasis', 'mdma', 'anfetamina', 'anfetaminas', 'metanfetamina', 'ketamina', 'popper', 'poppers', 'tripi', 'tripis', 'alucinógeno', 'alucinógenos', 'ayahuasca', 'opio',
      'hacer de mula', 'paquete sin abrir', 'sin abrir el paquete', 'sin preguntar qué lleva', 'no preguntes qué lleva',
      // catalán / inglés
      'drogues', 'haixix', 'cocaine', 'heroin', 'meth',
    ],
  },
  {
    id: 'money',
    message: 'En barrio. se intercambia tiempo, no dinero.',
    terms: [
      'euro', 'euros', 'eur', 'dólar', 'dólares', 'pelas', 'pavos', 'napos', 'efectivo', 'en metálico', 'bizum', 'paypal', 'revolut', 'venmo',
      'transferencia', 'transferencias', 'transferir', 'ingreso en cuenta', 'western union', 'moneygram', 'bitcoin', 'btc', 'cripto', 'criptomonedas', 'ethereum',
      'invertir', 'inversión', 'inversores', 'rentabilidad', 'ganar dinero', 'gana dinero', 'ingresos extra', 'dinero extra', 'ponzi', 'pirámide', 'piramidal', 'multinivel', 'mlm',
      'casino', 'apuestas', 'apostar', 'apuesta', 'póker', 'lotería', 'quiniela', 'rifa', 'rifas',
      'precio', 'precios', 'tarifa', 'tarifas', 'presupuesto', 'factura', 'facturas', 'facturar', 'cobro', 'cobrar', 'cobras', 'cobramos', 'cobraré', 'sueldo', 'salario', 'nómina', 'honorarios', 'comisión', 'comisiones',
      'en negro', 'trabajo en negro', 'pagar en negro',
      // catalán / inglés
      'diners', 'efectiu', 'preu', 'preus', 'cash', 'money',
    ],
  },
  {
    id: 'scam_illegal',
    message: 'No se permite contenido ilegal, fraudulento o engañoso.',
    terms: [
      'estafa', 'estafas', 'estafar', 'estafador', 'fraude', 'fraudulento', 'falsificar', 'falsificación', 'falsificado',
      'documentos falsos', 'papeles falsos', 'dni falso', 'pasaporte falso', 'carnet falso', 'título falso', 'certificado falso', 'receta falsa', 'baja falsa', 'justificante falso', 'contrato falso', 'alta falsa',
      'empadronamiento falso', 'vender empadronamiento', 'alquilar empadronamiento', 'empadronarme en tu casa', 'empadronarte en mi casa',
      'matrimonio de conveniencia', 'matrimonio blanco', 'casarme por papeles', 'casarse por papeles',
      'robar', 'robo', 'robos', 'ladrón', 'ladrones', 'hurto', 'hurtar', 'atracar', 'atraco', 'atracos', 'allanar', 'allanamiento', 'entrar a robar', 'entrar sin permiso',
      'forzar la puerta', 'forzar cerradura', 'forzar una cerradura', 'ganzúa', 'bumping', 'abrir un coche', 'abrir coches', 'puentear', 'arrancar sin llave', 'hacer un puente',
      'contador manipulado', 'manipular el contador', 'pinchar la luz', 'enganchar la luz', 'enganchar el agua', 'enganche ilegal',
      'quitar el gps', 'cambiar imei', 'imei', 'móvil robado', 'movil robado', 'blanqueo', 'blanquear', 'lavar dinero', 'lavado de dinero', 'evadir impuestos', 'evasión fiscal', 'sin declarar',
      'contrabando', 'contrabandista', 'pirata', 'piratear', 'pirateo', 'piratería', 'crackear', 'keygen', 'licencia pirata', 'copia pirata', 'iptv', 'torrent', 'descargas ilegales',
      'hackear', 'hackeo', 'ddos', 'ransomware', 'phishing', 'malware', 'troyano', 'keylogger', 'botnet', 'comprar seguidores', 'seguidores falsos', 'reseñas falsas', 'reviews falsas',
      'soborno', 'sobornar', 'cohecho', 'trata de personas', 'trata de blancas', 'tráfico de personas', 'explotación laboral', 'esclavitud', 'esclavo', 'esclava',
      'inmigración ilegal', 'cruzar la frontera', 'pasar la frontera', 'pasar de contrabando',
      'hacerme el examen', 'hacer mi examen', 'hacerme los exámenes', 'suplantar', 'suplantación', 'hacerme pasar por', 'hacerte pasar por', 'plagiar', 'plagio',
      'comprar tfg', 'vender tfg', 'hacerme el tfg', 'hacerme el tfm', 'hacerme la tesis', 'hacer mi tfg', 'hacer mi tfm', 'hacer mi tesis',
      'sin carnet', 'sin carné', 'sin permiso de conducir', 'sin seguro', 'sin itv', 'taxi pirata', 'conducir borracho', 'conducir ebrio', 'carreras ilegales',
    ],
  },
  {
    id: 'home_access',
    message: 'Por seguridad, no se pueden compartir claves ni datos que faciliten el acceso a una vivienda.',
    // Lo demás ("llaves", "me voy de viaje"…) va a REVIEW: es el caso de uso normal de cuidar mascotas o plantas.
    terms: ['código de la alarma', 'clave de la alarma', 'dinero escondido', 'dónde guardas el dinero', 'dónde guardan el dinero', 'entrar de noche', 'entrar sin avisar', 'entrar sin llamar', 'mientras duermes', 'mientras duerme', 'mientras duermen'],
  },
  {
    id: 'personal_data',
    message: 'No compartas datos personales o bancarios en una tarjeta.',
    terms: [
      'número de cuenta', 'número de tarjeta', 'tarjeta de crédito', 'tarjeta de débito', 'cvv', 'código de seguridad', 'clave del cajero', 'pin de la tarjeta', 'pin del cajero',
      'datos bancarios', 'banca online', 'clave de la banca', 'acceso a su cuenta', 'acceso a tu cuenta', 'acceso a la cuenta', 'poder notarial', 'testamento', 'firma en blanco', 'firmar documentos en blanco',
      'mi dni', 'tu dni', 'foto del dni', 'foto de tu dni', 'copia del dni', 'fotocopia del dni', 'tu pasaporte', 'copia del pasaporte', 'foto del pasaporte', 'seguridad social',
    ],
  },
  {
    id: 'external_contact',
    message: 'Para hablar, usa el chat de barrio.; no compartas contactos externos.',
    terms: [
      'whatsapp', 'wasap', 'guasap', 'wats', 'telegram', 'signal', 'instagram', 'insta', 'tiktok', 'facebook', 'snapchat', 'discord', 'twitter', 'linkedin', 'skype',
      'mi número', 'mi teléfono', 'mi móvil es', 'mi correo', 'mi email', 'mi mail', 'mi gmail', 'mi hotmail', 'escríbeme al', 'llámame', 'llámame al', 'mándame un whats',
      'pásame tu número', 'dame tu número', 'dame tu teléfono', 'te dejo mi número', 'déjame tu teléfono', 'agrégame', 'sígueme', 'mi usuario es', 'mi perfil de',
    ],
  },
  {
    id: 'surveillance',
    message: 'No se permite espiar, rastrear ni grabar a otras personas.',
    terms: [
      'espiar', 'espionaje', 'espía', 'spyware', 'stalkerware', 'stalkear', 'stalker',
      'localizar a mi ex', 'localizar a mi pareja', 'seguir a mi ex', 'seguir a mi pareja', 'vigilar a mi pareja', 'vigilar a mi ex', 'vigilar a mi mujer', 'vigilar a mi marido',
      'controlar el móvil de mi pareja', 'revisar el móvil de mi pareja', 'mirar el móvil de mi pareja', 'entrar en el móvil de', 'entrar en el whatsapp de', 'hackear el whatsapp', 'acceder al móvil de',
      'instalar un localizador', 'localizador gps escondido', 'cámara oculta', 'cámaras ocultas', 'cámara espía', 'micrófono oculto', 'micro espía',
      'grabar a escondidas', 'grabar sin que lo sepa', 'grabar sin su permiso', 'grabar sin que se entere',
      'fotos de mi ex', 'difundir fotos', 'filtrar fotos', 'revenge porn', 'pornovenganza', 'deepfake', 'deepfakes', 'desnudar con ia', 'quitar la ropa con ia',
    ],
  },
  {
    id: 'self_harm',
    message: 'Si estás pasando un mal momento, no estás sola/o: puedes llamar al 024 (atención a la conducta suicida, 24 h, gratuito).',
    terms: [
      'suicidio', 'suicidarme', 'suicidarse', 'suicidar', 'quitarme la vida', 'quitarse la vida', 'acabar con mi vida', 'acabar con todo', 'no quiero vivir', 'no quiero seguir viviendo',
      'quiero morirme', 'quiero morir', 'autolesión', 'autolesiones', 'autolesionarme', 'cortarme las venas', 'pro ana', 'proana', 'pro mia', 'promia', 'thinspo',
      'suïcidi', 'vull morir', 'no vull viure', 'kill myself', 'suicide',
    ],
  },
  {
    id: 'health_regulated',
    message: 'barrio. no permite pedir ni ofrecer medicamentos con receta ni prácticas sanitarias reguladas.',
    terms: [
      'sin receta', 'tramadol', 'fentanilo', 'morfina', 'oxicodona', 'codeína', 'metadona', 'benzodiacepinas', 'benzos', 'diazepam', 'valium', 'lorazepam', 'orfidal', 'alprazolam', 'xanax',
      'lexatin', 'clonazepam', 'rivotril', 'trankimazin', 'zolpidem', 'zopiclona', 'ritalin', 'rubifen', 'concerta', 'adderall',
      'esteroides', 'anabolizantes', 'clembuterol', 'dopaje', 'doparse', 'misoprostol', 'cytotec', 'píldora abortiva', 'abortivo',
      'suturar', 'dar puntos de sutura', 'coser heridas', 'cirugía casera', 'extraer sangre', 'botox', 'ácido hialurónico',
      'cura milagro', 'curas milagrosas', 'curar el cáncer', 'curar la diabetes', 'curar el autismo', 'terapia de conversión', 'terapia de reorientación',
      'mms', 'dióxido de cloro', 'curandero', 'curandera', 'amarres', 'no vacunes', 'no vacunar a', 'no vacunes a tus hijos',
    ],
  },
  {
    id: 'animal_abuse',
    message: 'No se permite el maltrato ni el comercio de animales.',
    terms: [
      'peleas de perros', 'pelea de perros', 'peleas de gallos', 'pelea de gallos', 'zoofilia', 'bestialismo', 'maltrato animal', 'maltratar animales', 'maltratar a un animal',
      'pegar al perro', 'pegar a mi perro', 'envenenar', 'veneno para perros', 'veneno para gatos', 'matar al perro', 'matar al gato', 'matar gatos', 'matar perros',
      'sacrificar al perro', 'sacrificar al gato', 'deshacerme del perro', 'deshacerme del gato', 'abandonar al perro', 'abandonar a mi gato', 'abandonar un animal', 'abandono de animales',
      'vendo cachorros', 'vendo cachorro', 'venta de cachorros', 'cachorros en venta', 'tráfico de animales', 'traficar con animales', 'caza furtiva', 'pesca furtiva',
    ],
  },
  {
    // El texto del usuario acaba dentro de un prompt: hay que frenar la inyección.
    id: 'prompt_injection',
    message: 'Ese texto no se puede publicar.',
    terms: [
      'ignora las instrucciones', 'ignora todas las instrucciones', 'ignora las reglas', 'ignora las normas', 'ignora todo lo anterior', 'ignora lo anterior', 'ignora lo que te han dicho',
      'olvida lo anterior', 'olvida todo lo anterior', 'olvida tus instrucciones', 'olvida las instrucciones', 'no sigas las instrucciones',
      'salta la moderación', 'sáltate la moderación', 'desactiva la moderación', 'sin moderación', 'sin filtros', 'sin restricciones',
      'prompt del sistema', 'system prompt', 'prompt injection', 'instrucciones del sistema', 'modo desarrollador', 'developer mode', 'modo dios', 'god mode', 'jailbreak', 'dan mode',
      'ignore previous', 'ignore all previous', 'ignore the above', 'ignore your instructions', 'disregard', 'override',
      'actúa como', 'finge que eres', 'haz como si fueras', 'a partir de ahora eres', 'a partir de ahora actúa', 'nuevas instrucciones',
      'responde únicamente', 'responde solo con', 'devuelve únicamente', 'devuelve solo', 'devuelve el json',
      'marca como seguro', 'clasifica como seguro', 'clasifícalo como seguro', 'este texto es seguro', 'safe true', 'safe: true',
    ],
  },
];

/* ───────────────────────── REVIEW (ambiguas: no se bloquean, se pasan a la IA como pista) ───────────────────────── */

export const REVIEW_RULES: Rule[] = [
  { id: 'sexual_ambiguous', message: '', terms: [
    'desnudo', 'desnuda', 'desnudos', 'desnudas', 'desnudez', 'masaje', 'masajes', 'masajista', 'fisioterapia', 'íntimo', 'íntima', 'íntimos', 'intimidad', 'sensual', 'sensuales',
    'cuerpo', 'cuerpazo', 'guapa', 'guapo', 'guapas', 'guapos', 'atractiva', 'atractivo', 'buen físico', 'buena presencia', 'de buen ver',
    'pareja', 'novia', 'novio', 'ligar', 'ligue', 'cita', 'citas', 'romántica', 'romántico', 'romance', 'amante', 'amantes', 'besar', 'beso', 'besos',
    'acompañante', 'acompañantes', 'compañía', 'modelo', 'modelos', 'posar', 'posado', 'fotos sensuales', 'boudoir', 'pack', 'packs', 'webcam', 'cam',
    'higiene íntima', 'duchar', 'ducharlo', 'ducharla', 'bañar', 'bañarlo', 'bañarla', 'pañal', 'pañales', 'aseo personal', 'senos', 'pechos', 'tantra', 'tántrico', 'polvo',
  ] },
  { id: 'minors_ambiguous', message: '', terms: [
    'niño', 'niña', 'niños', 'niñas', 'menor', 'menores', 'menor de edad', 'menores de edad', 'bebé', 'bebés', 'canguro', 'niñera', 'recoger del cole', 'colegio', 'instituto',
    'adolescente', 'adolescentes', 'chaval', 'chavala', 'chavales', 'críos', 'hijo', 'hija', 'hijos', 'sobrino', 'sobrina', 'nieto', 'nieta',
    'a solas', 'se queda a dormir', 'dormir en casa', 'pijamada', 'colonias', 'extraescolar', 'extraescolares',
  ] },
  { id: 'violence_ambiguous', message: '', terms: [
    'matar', 'mato', 'plagas', 'cucarachas', 'ratas', 'ratones', 'raticida', 'veneno', 'pegar', 'pegarle', 'golpe', 'golpes', 'pistola', 'bomba', 'bombas', 'explosión',
    'cuchillo', 'cuchillos', 'navaja', 'navajas', 'hacha', 'machete', 'caza', 'cazar', 'cazador', 'pelea', 'peleas', 'pelear', 'sangre', 'herida', 'heridas',
    'violencia', 'violento', 'violenta', 'maltrato', 'agresión', 'boxeo', 'defensa personal', 'disparar', 'disparo', 'disparos', 'petardos', 'pirotecnia', 'quemar', 'incendio',
  ] },
  { id: 'drugs_ambiguous', message: '', terms: [
    'alcohol', 'alcohólico', 'cerveza', 'cervezas', 'vino', 'copa', 'copas', 'botellón', 'birra', 'cubata', 'chupitos', 'borracho', 'borracha', 'emborrachar', 'tabaco', 'cigarro', 'cigarros', 'vaper',
    'cannabis', 'cbd', 'hierba', 'hierbas', 'semillas', 'cultivo', 'cultivar', 'indoor', 'setas', 'hongos', 'amapola', 'coca', 'speed', 'crack',
    'medicamento', 'medicamentos', 'pastillas', 'pastilla', 'medicación', 'receta', 'recetas', 'inyección', 'inyecciones', 'inyectar', 'insulina', 'sobredosis', 'fumar', 'fumo',
  ] },
  { id: 'money_ambiguous', message: '', terms: [
    'dinero', 'pagar', 'pago', 'pagos', 'pagado', 'gratis', 'gratuito', 'barato', 'caro', 'a cambio de', 'propina', 'donación', 'donativo', 'regalo', 'gasolina', 'gastos',
    'vender', 'vendo', 'venta', 'comprar', 'compro', 'alquiler', 'alquilar', 'alquilo', 'segunda mano', 'wallapop', 'milanuncios', 'vinted',
    'préstamo', 'prestar', 'deuda', 'deudas', 'banco', 'bancario', 'hipoteca', 'sorteo', 'contrato', 'empleo', 'trabajo', 'autónomo', 'empresa', 'negocio', 'cliente', 'clientes', 'profesional', 'catering', 'tienda',
  ] },
  { id: 'home_access_ambiguous', message: '', terms: [
    'llave', 'llaves', 'me voy', 'nos vamos', 'viaje', 'vacaciones', 'casa vacía', 'piso vacío', 'estaré fuera', 'estaremos fuera', 'no hay nadie', 'no estoy en casa', 'ausente',
    'vivo sola', 'vivo solo', 'vivimos solos', 'sola en casa', 'solo en casa', 'alarma', 'portal', 'portero', 'timbre', 'ventana', 'balcón', 'terraza', 'azotea',
    'cerradura', 'cerrajero', 'caja fuerte', 'joyas', 'objetos de valor', 'objetos valiosos', 'wifi', 'wi fi', 'clave del wifi', 'puerta abierta', 'dejar la puerta abierta', 'trastero', 'garaje', 'buzón',
  ] },
  { id: 'surveillance_ambiguous', message: '', terms: [
    'ex', 'mi ex', 'expareja', 'ubicación', 'localizar', 'localización', 'gps', 'airtag', 'vigilar', 'controlar a', 'contraseña', 'contraseñas', 'claves', 'password', 'privacidad', 'datos personales', 'rastrear', 'cámara', 'cámaras', 'grabar',
  ] },
  { id: 'health_ambiguous', message: '', terms: [
    'enfermera', 'enfermero', 'médico', 'médica', 'doctor', 'doctora', 'clínica', 'hospital', 'urgencias', 'diagnóstico', 'diagnosticar', 'enfermedad', 'enfermedades', 'síntomas', 'tratamiento', 'terapia', 'terapeuta',
    'psicólogo', 'psicóloga', 'psiquiatra', 'ansiedad', 'depresión', 'salud mental', 'trastorno', 'autismo', 'tdah', 'alzheimer', 'demencia', 'cáncer', 'quimioterapia', 'diabetes', 'embarazo', 'embarazada', 'aborto',
    'curar', 'curas', 'vendaje', 'tensión', 'glucosa', 'oxígeno', 'sonda', 'catéter', 'dieta', 'adelgazar', 'ayuno', 'suplementos', 'vitaminas', 'homeopatía', 'reiki', 'acupuntura', 'osteópata', 'quiropráctico',
    'tarot', 'vidente', 'horóscopo', 'anorexia', 'bulimia', 'dejar de comer', 'eutanasia', 'hacerme daño', 'tatuaje', 'tatuar', 'piercing',
  ] },
  { id: 'elder_finance', message: '', terms: [
    'pensión', 'cajero', 'cuenta bancaria', 'tarjeta bancaria', 'herencia', 'heredero', 'notaría', 'firmar', 'firma', 'escritura', 'pin', 'recoger la pensión',
  ] },
  { id: 'discrimination_ambiguous', message: '', terms: [
    'solo mujeres', 'solo hombres', 'solo chicas', 'solo chicos', 'solo gente joven', 'solo jóvenes', 'inmigrantes', 'inmigrante', 'extranjero', 'extranjeros', 'moros', 'musulmanes', 'musulmán',
    'judíos', 'gitanos', 'negros', 'blancos', 'latinos', 'chinos', 'gay', 'gays', 'lesbianas', 'trans', 'discapacitados', 'viejos', 'viejo', 'vieja', 'gordo', 'gorda', 'feo', 'fea',
  ] },
  { id: 'politics_religion', message: '', terms: [
    'religión', 'religioso', 'creyentes', 'ateos', 'católico', 'católica', 'islam', 'iglesia', 'mezquita', 'partido político', 'política', 'políticos', 'votar', 'vota', 'manifestación', 'sindicato',
    'secta', 'evangelizar', 'predicar', 'biblia', 'corán', 'facha', 'fascista', 'comunista', 'holocausto',
  ] },
  { id: 'vulgar', message: '', terms: [
    'mierda', 'joder', 'jodido', 'jodida', 'cojones', 'coño', 'culo', 'culos', 'cabrón', 'cabrona', 'capullo', 'capulla', 'pendejo', 'pendeja', 'idiota', 'estúpido', 'estúpida', 'inútil', 'merda',
  ] },
  { id: 'scam_ambiguous', message: '', terms: [
    'okupa', 'okupar', 'ocupar una vivienda', 'sin papeles', 'empadronamiento', 'empadronar', 'hacker', 'grafiti', 'pintadas', 'vandalismo', 'vaciar piso', 'vaciar casa', 'desahucio',
    'limpiar sangre', 'limpiar huellas', 'productos químicos', 'amoniaco', 'ácido', 'lejía', 'instalación eléctrica', 'instalar gas', 'trabajos en altura', 'tejado',
  ] },
];

export const HINT_LABELS: Record<string, string> = {
  // ids de REVIEW_RULES
  home_access_ambiguous: 'oferta que implica acceso a domicilio privado de forma ambigua',
  sexual_ambiguous: 'posible insinuación sexual o propuesta de contacto íntimo',
  minors_ambiguous: 'contenido que involucra a menores',
  violence_ambiguous: 'posible referencia a violencia o armas',
  drugs_ambiguous: 'posible referencia a alcohol, drogas o medicamentos',
  money_ambiguous: 'posible intercambio de dinero, compraventa o actividad comercial',
  surveillance_ambiguous: 'posible vigilancia, rastreo o acceso a datos de otra persona',
  health_ambiguous: 'posible práctica sanitaria regulada o consejo de salud',
  elder_finance: 'posible abuso económico (pensión, banca, firmas, herencias)',
  discrimination_ambiguous: 'posible condición discriminatoria o referencia a un colectivo',
  politics_religion: 'contenido político o religioso',
  vulgar: 'lenguaje vulgar u ofensivo',
  scam_ambiguous: 'posible actividad ilegal, ocupación de vivienda o trabajo de riesgo',
  // ids de RAW_PATTERNS con severity 'review'
  minors: 'mención de la edad de un posible menor',
  address: 'dirección exacta de un domicilio',
  markup: 'marcado, código o JSON en el texto (posible inyección de prompt)',
};

/* ───────────────────────── MOTOR ───────────────────────── */

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function toRegex(term: string | RegExp): RegExp {
  if (term instanceof RegExp) return term;
  const stem = term.endsWith('*');
  const t = norm(stem ? term.slice(0, -1) : term);
  return new RegExp(`(?<![\\p{L}\\d])${esc(t).replace(/ /g, '\\s+')}${stem ? '\\p{L}*' : ''}(?![\\p{L}\\d])`, 'u');
}

type Compiled = { id: string; message: string; label: string; re: RegExp; compact?: string };

function compile(rules: Rule[], withCompact: boolean): Compiled[] {
  return rules.flatMap((r) =>
    r.terms.map((t) => {
      const label = t instanceof RegExp ? t.source : t;
      const n = t instanceof RegExp || t.endsWith('*') ? '' : norm(t);
      // Evasión con espacios dentro de la palabra ("vio lacion"): solo términos largos de una palabra
      const compact = withCompact && n.length >= 9 && !n.includes(' ') ? n : undefined;
      return { id: r.id, message: r.message, label, re: toRegex(t), compact };
    }),
  );
}

const BLOCK = compile(BLOCK_RULES, true);
const REVIEW = compile(REVIEW_RULES, false);

export type Verdict =
  | { action: 'block'; category: string; message: string; matched: string }
  | { action: 'review'; hints: { category: string; matched: string }[] }
  | { action: 'ok' };

export function checkText(text: string): Verdict {
  const raw = text.replace(/[​-‏⁠-⁤﻿]/g, '');
  const hints: { category: string; matched: string }[] = [];

  for (const p of RAW_PATTERNS) {
    const m = raw.match(p.re);
    if (!m) continue;
    if (p.severity === 'block') return { action: 'block', category: p.id, message: p.message, matched: m[0] };
    hints.push({ category: p.id, matched: m[0] });
  }

  const variants = [norm(raw, 'i'), norm(raw, 'l')];
  const compacts = variants.map((v) => v.replace(/\s+/g, ''));

  for (const c of BLOCK) {
    if (variants.some((v) => c.re.test(v)) || (c.compact && compacts.some((v) => v.includes(c.compact!)))) {
      return { action: 'block', category: c.id, message: c.message, matched: c.label };
    }
  }
  for (const c of REVIEW) {
    if (variants.some((v) => c.re.test(v))) hints.push({ category: c.id, matched: c.label });
  }
  return hints.length ? { action: 'review', hints } : { action: 'ok' };
}

/*
 * Uso en el endpoint de crear tarjeta (ANTES de llamar a la IA y OTRA VEZ antes de guardar, doble moderación):
 *
 *   const v = checkText(`${title} ${description} ${rawText}`);
 *   if (v.action === 'block') return res.status(422).json({ error: 'moderation_blocked', message: v.message });
 *   const aiVerdict = await classifyWithAI(text, v.action === 'review' ? v.hints : []); // pista para el clasificador
 */

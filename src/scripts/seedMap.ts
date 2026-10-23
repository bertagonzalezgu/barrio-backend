import 'dotenv/config';
import { prisma } from '../config/prisma';
import type { CardCategory, CardStatus, CardType } from '../generated/prisma/client';

// Datos de demo para el mapa (tarjeta 16). Idempotente: ids y firebaseUid fijos, así que ejecutarlo dos veces deja lo mismo.

interface DemoUser {
  firebaseUid: string;
  name: string;
  email: string;
}

interface DemoCard {
  id: string;
  author: string;
  type: CardType;
  category: CardCategory;
  title: string;
  description: string;
  icon: string;
  hours: number;
  lat: number | null;
  lng: number | null;
  status?: CardStatus;
}

const USERS: DemoUser[] = [
  { firebaseUid: 'demo-map-merce', name: 'Mercè (demo)', email: 'demo-map-merce@barrio.local' },
  { firebaseUid: 'demo-map-jordi', name: 'Jordi (demo)', email: 'demo-map-jordi@barrio.local' },
  { firebaseUid: 'demo-map-laia', name: 'Laia (demo)', email: 'demo-map-laia@barrio.local' },
];

const CARDS: DemoCard[] = [
  // Eixample
  {
    id: '00000000-0000-4000-8000-000000016001',
    author: 'demo-map-merce',
    type: 'offer',
    category: 'home_repairs',
    title: 'Arreglo grifos y persianas',
    description: 'Tengo herramientas y paciencia. Pequeñas reparaciones en casa, cerca de la Sagrada Família.',
    icon: 'home-repairs-wrench',
    hours: 2,
    lat: 41.40363,
    lng: 2.17436,
  },
  {
    id: '00000000-0000-4000-8000-000000016002',
    author: 'demo-map-merce',
    type: 'request',
    category: 'digital',
    title: 'Ayuda para configurar el móvil nuevo',
    description: 'Necesito pasar fotos y contactos del móvil viejo al nuevo.',
    icon: 'digital-pc',
    hours: 1,
    lat: 41.39535,
    lng: 2.16188,
  },
  {
    id: '00000000-0000-4000-8000-000000016003',
    author: 'demo-map-merce',
    type: 'offer',
    category: 'cooking',
    title: 'Clase de cocina de mercado',
    description: 'Compramos juntas en el Ninot y cocinamos algo sencillo de temporada.',
    icon: 'cooking-pan',
    hours: 3,
    lat: 41.38795,
    lng: 2.15438,
  },
  {
    id: '00000000-0000-4000-8000-000000016004',
    author: 'demo-map-merce',
    type: 'offer',
    category: 'digital',
    title: 'Te enseño a usar hojas de cálculo',
    description: 'Lo básico para llevar las cuentas de casa sin agobios.',
    icon: 'digital-pc',
    hours: 2,
    lat: 41.38627,
    lng: 2.16388,
  },
  // Gràcia. Las dos primeras caen a propósito en la misma celda de 3 decimales (41.402, 2.157),
  // para ver en el frontend qué pasa cuando dos pins aproximados coinciden.
  {
    id: '00000000-0000-4000-8000-000000016005',
    author: 'demo-map-jordi',
    type: 'offer',
    category: 'petcare',
    title: 'Paseo perros por las mañanas',
    description: 'Salgo cada día a las 8 por la plaza del Sol; puedo llevar el tuyo.',
    icon: 'petcare-dog',
    hours: 1,
    lat: 41.4021,
    lng: 2.15696,
  },
  {
    id: '00000000-0000-4000-8000-000000016006',
    author: 'demo-map-jordi',
    type: 'offer',
    category: 'learning',
    title: 'Conversación en catalán',
    description: 'Un café a la semana para practicar catalán sin presión.',
    icon: 'learning-languages',
    hours: 1,
    lat: 41.40238,
    lng: 2.15712,
  },
  {
    id: '00000000-0000-4000-8000-000000016007',
    author: 'demo-map-jordi',
    type: 'request',
    category: 'garden',
    title: 'Regar plantas en agosto',
    description: 'Me voy dos semanas y el balcón no sobrevive solo.',
    icon: 'garden-plant',
    hours: 2,
    lat: 41.40461,
    lng: 2.15985,
  },
  // Poblenou
  {
    id: '00000000-0000-4000-8000-000000016008',
    author: 'demo-map-laia',
    type: 'offer',
    category: 'digital',
    title: 'Reviso portátiles lentos',
    description: 'Limpieza, actualizaciones y copias de seguridad.',
    icon: 'digital-pc',
    hours: 2,
    lat: 41.40312,
    lng: 2.20248,
  },
  {
    id: '00000000-0000-4000-8000-000000016009',
    author: 'demo-map-laia',
    type: 'request',
    category: 'moving',
    title: 'Ayuda para bajar un sofá',
    description: 'Un tercero sin ascensor; con dos personas más basta.',
    icon: 'moving-sofa',
    hours: 1,
    lat: 41.40446,
    lng: 2.19733,
  },
  {
    id: '00000000-0000-4000-8000-000000016010',
    author: 'demo-map-laia',
    type: 'offer',
    category: 'sports',
    title: 'Compañía para correr por la playa',
    description: 'Ritmo tranquilo, 5 km por el Bogatell los domingos.',
    icon: 'sports-gym',
    hours: 1,
    lat: 41.39468,
    lng: 2.207,
  },
  // No deben salir en el mapa: sin coordenadas, completada y denunciada.
  {
    id: '00000000-0000-4000-8000-000000016011',
    author: 'demo-map-merce',
    type: 'request',
    category: 'peoplecare',
    title: 'Acompañar a mi madre al médico',
    description: 'Una mañana entre semana, ida y vuelta en metro.',
    icon: 'peoplecare-handshake',
    hours: 2,
    lat: null,
    lng: null,
  },
  {
    id: '00000000-0000-4000-8000-000000016012',
    author: 'demo-map-laia',
    type: 'offer',
    category: 'transport',
    title: 'Llevo cosas en furgoneta',
    description: 'Trayectos cortos dentro de Barcelona.',
    icon: 'transport-pickup',
    hours: 2,
    lat: 41.39971,
    lng: 2.19458,
    status: 'completed',
  },
  {
    id: '00000000-0000-4000-8000-000000016013',
    author: 'demo-map-jordi',
    type: 'request',
    category: 'events',
    title: 'Busco gente para una fiesta de calle',
    description: 'Montar y recoger mesas para la fiesta mayor.',
    icon: 'events-party-confetti',
    hours: 3,
    lat: 41.39968,
    lng: 2.15356,
    status: 'reported',
  },
];

// Solo el host: la URL lleva usuario y contraseña.
function databaseHost(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL no está definida.');
  return new URL(url).hostname;
}

function assertSafeToRun(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed:map no se ejecuta con NODE_ENV=production.');
  }
  console.log(`Base de datos: ${databaseHost()}`);
  if (process.env.SEED_MAP_CONFIRM !== '1') {
    throw new Error('Revisa el host de arriba y vuelve a ejecutarlo con SEED_MAP_CONFIRM=1 para escribir.');
  }
}

const run = async (): Promise<void> => {
  assertSafeToRun();

  const userIds = new Map<string, string>();
  for (const user of USERS) {
    const { id } = await prisma.user.upsert({
      where: { firebaseUid: user.firebaseUid },
      create: user,
      update: { name: user.name, email: user.email },
      select: { id: true },
    });
    userIds.set(user.firebaseUid, id);
  }
  console.log(`✅ Usuarias de demo: ${USERS.length}`);

  for (const { author, status = 'active', ...card } of CARDS) {
    const authorId = userIds.get(author);
    if (!authorId) throw new Error(`La card ${card.id} apunta a una autora que no está en USERS: ${author}`);
    // En update se reescriben todos los campos, así que una card editada a mano vuelve a su estado de demo.
    const data = { ...card, authorId, status };
    await prisma.card.upsert({ where: { id: card.id }, create: data, update: data });
  }
  const onMap = CARDS.filter((card) => (card.status ?? 'active') === 'active' && card.lat !== null).length;
  console.log(`✅ Cards de demo: ${CARDS.length} (${onMap} visibles en el mapa)`);
};

run()
  .catch((err) => {
    console.error('❌ seedMap falló:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

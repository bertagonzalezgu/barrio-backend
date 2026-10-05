import 'dotenv/config';
import { prisma } from '../config/prisma';

const run = async (): Promise<void> => {
  const ana = await prisma.user.create({
    data: { firebaseUid: 'test-firebase-uid-001', name: 'Ana Test', email: 'ana.test@barrio.local' },
  });
  const berta = await prisma.user.create({
    data: { firebaseUid: 'test-firebase-uid-002', name: 'Berta Test', email: 'berta.test@barrio.local' },
  });
  console.log(`✅ Users creados:      ${ana.name} (${ana.id}), ${berta.name} (${berta.id})`);

  const card = await prisma.card.create({
    data: {
      authorId: ana.id,
      type: 'offer',
      title: 'Ayudo con mudanzas ligeras',
      description: 'Puedo ayudarte a mover cajas y muebles pequeños por el barrio.',
      category: 'home',
      hours: 2,
      icon: 'truck',
      lat: 41.3851,
      lng: 2.1734,
    },
  });
  console.log(`✅ Card creada:        ${card.id}  type="${card.type}"  category="${card.category}"`);

  const exchange = await prisma.exchange.create({
    data: { cardId: card.id, proposerId: berta.id, receiverId: ana.id, hours: 2, status: 'confirmed' },
  });
  const tx = await prisma.timeTransaction.create({
    data: { type: 'transfer', exchangeId: exchange.id, fromUserId: berta.id, toUserId: ana.id, hours: 2 },
  });
  console.log(`✅ Exchange + TimeTransaction: ${berta.name} → ${ana.name}  hours=${tx.hours}`);

  await prisma.timeTransaction.delete({ where: { id: tx.id } });
  await prisma.exchange.delete({ where: { id: exchange.id } });
  await prisma.card.delete({ where: { id: card.id } });
  await prisma.user.deleteMany({ where: { id: { in: [ana.id, berta.id] } } });
  console.log('🧹 Filas de prueba eliminadas.');

  console.log('\n✅ seedTest completado sin errores.\n');
};

run()
  .catch((err) => {
    console.error('❌ seedTest falló:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

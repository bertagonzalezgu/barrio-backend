import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../config/db';
import { User } from '../models/User';
import { Ticket } from '../models/Ticket';
import { Transaction } from '../models/Transaction';

const run = async (): Promise<void> => {
  await connectDB();

  const testUser = await User.create({
    firebaseUid: 'test-firebase-uid-001',
    name: 'Ana Test',
    email: 'ana.test@barrio.local',
    avatar: '',
    verified: false,
    rating: 0,
    credits: 2,
  });
  console.log(`✅ User creado:       _id=${testUser._id}  name="${testUser.name}"  credits=${testUser.credits}h`);

  const testTicket = await Ticket.create({
    authorId: testUser._id,
    type: 'offer',
    title: 'Ayudo con mudanzas ligeras',
    description: 'Puedo ayudarte a mover cajas y muebles pequeños por el barrio.',
    category: 'home',
    hours: 2,
    icon: 'truck',
    lat: 41.3851,
    lng: 2.1734,
    status: 'active',
  });
  console.log(`✅ Ticket creado:     _id=${testTicket._id}  type="${testTicket.type}"  category="${testTicket.category}"`);

  const testUserB = await User.create({
    firebaseUid: 'test-firebase-uid-002',
    name: 'Berta Test',
    email: 'berta.test@barrio.local',
    credits: 5,
  });

  const testTx = await Transaction.create({
    type: 'exchange',
    ticketId: testTicket._id,
    fromUserId: testUserB._id,
    toUserId: testUser._id,
    hours: 2,
  });
  console.log(`✅ Transaction creada: _id=${testTx._id}  from=${testUserB.name} → to=${testUser.name}  hours=${testTx.hours}`);

  await Transaction.deleteOne({ _id: testTx._id });
  await Ticket.deleteOne({ _id: testTicket._id });
  await User.deleteMany({ firebaseUid: { $in: ['test-firebase-uid-001', 'test-firebase-uid-002'] } });
  console.log('🧹 Documentos de prueba eliminados.');

  await mongoose.disconnect();
  console.log('\n✅ seedTest completado sin errores.\n');
};

run().catch((err) => {
  console.error('❌ seedTest falló:', err);
  process.exit(1);
});
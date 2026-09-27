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
    nombre: 'Ana Test',
    email: 'ana.test@barrio.local',
    avatar: '',
    verificado: false,
    rating: 0,
    creditos: 2,
  });
  console.log(`✅ User creado:       _id=${testUser._id}  nombre="${testUser.nombre}"  creditos=${testUser.creditos}h`);

  const testTicket = await Ticket.create({
    autorId: testUser._id,
    tipo: 'ofrezco',
    titulo: 'Ayudo con mudanzas ligeras',
    descripcion: 'Puedo ayudarte a mover cajas y muebles pequeños por el barrio.',
    categoria: 'Hogar',
    horas: 2,
    icono: 'truck',
    lat: 41.3851,
    lng: 2.1734,
    estado: 'activo',
  });
  console.log(`✅ Ticket creado:     _id=${testTicket._id}  tipo="${testTicket.tipo}"  categoria="${testTicket.categoria}"`);

  const testUserB = await User.create({
    firebaseUid: 'test-firebase-uid-002',
    nombre: 'Berta Test',
    email: 'berta.test@barrio.local',
    creditos: 5,
  });

  const testTx = await Transaction.create({
    tipo: 'intercambio',
    ticketId: testTicket._id,
    deUserId: testUserB._id, 
    aUserId: testUser._id,  
    horas: 2,
  });
  console.log(`✅ Transaction creada: _id=${testTx._id}  de=${testUserB.nombre} → a=${testUser.nombre}  horas=${testTx.horas}`);

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
import 'dotenv/config';
import app from './app';
import { prisma } from './config/prisma';

const PORT = process.env.PORT ?? 3000;

prisma
  .$connect()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
    });
  })
  .catch((error: unknown) => {
    console.error('❌ No se pudo arrancar el servidor:', error);
    process.exit(1);
  });

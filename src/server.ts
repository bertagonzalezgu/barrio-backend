import 'dotenv/config';
import app from './app';
import { prisma } from './config/prisma';

const PORT = process.env.PORT ?? 3000;

// Prisma conecta de forma perezosa en la primera consulta: se fuerza aquí para que un
// DATABASE_URL incorrecto haga fallar el arranque, no la primera petición de una usuaria.
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

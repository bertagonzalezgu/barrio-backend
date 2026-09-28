import express from 'express';
import cors from 'cors';
import walletRoutes from './routes/wallet';
import userRoutes from './routes/users';

// La app se exporta sin arrancar el servidor para poder testearla con supertest.
const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/wallet', walletRoutes);
app.use('/api/users', userRoutes);

export default app;

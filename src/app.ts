import express from 'express';
import cors from 'cors';
import walletRoutes from './routes/wallet';
import userRoutes from './routes/users';
import cardRoutes from './routes/cards';
import exchangeRoutes from './routes/exchanges';

// La app se exporta sin arrancar el servidor para poder testearla con supertest.
const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/wallet', walletRoutes);
app.use('/api/users', userRoutes);
app.use('/api/cards', cardRoutes);
app.use('/api/exchanges', exchangeRoutes);

export default app;

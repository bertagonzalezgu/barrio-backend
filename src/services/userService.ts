import { User, type IUser } from '../models/User';
import { grantWelcomeCredit } from './walletService';

interface RegisterUserInput {
  firebaseUid: string;
  email: string;
  nombre?: string;
}

type RegisterUserResult =
  | { ok: true; user: IUser }
  | { ok: false; reason: 'missing-nombre' };

/**
 * Crea el usuario si no existe y le concede el regalo de bienvenida. Idempotente:
 * se puede llamar tras el registro y en cada login sin duplicar usuario ni horas.
 * `nombre` solo es necesario la primera vez, cuando se crea el usuario.
 */
export async function registerUser({ firebaseUid, email, nombre }: RegisterUserInput): Promise<RegisterUserResult> {
  let user = await User.findOne({ firebaseUid });

  if (!user) {
    if (!nombre) return { ok: false, reason: 'missing-nombre' };
    // Upsert con $setOnInsert en vez de create: si dos peticiones llegan a la vez, no falla ninguna.
    user = await User.findOneAndUpdate(
      { firebaseUid },
      { $setOnInsert: { firebaseUid, email, nombre } },
      { upsert: true, returnDocument: 'after', runValidators: true }
    );
    if (!user) throw new Error(`No se pudo crear el usuario ${firebaseUid}`);
  }

  // Se llama también con usuarios ya existentes: repara el caso de un usuario creado sin regalo.
  const granted = await grantWelcomeCredit(user._id);
  if (granted) {
    user = (await User.findById(user._id)) ?? user;
  }

  return { ok: true, user };
}

import { User, type IUser } from '../models/User';
import { grantWelcomeCredit } from './walletService';

interface RegisterUserInput {
  firebaseUid: string;
  email: string;
  name?: string;
}

type RegisterUserResult =
  | { ok: true; user: IUser }
  | { ok: false; reason: 'missing-name' };

/**
 * Crea el usuario si no existe y le concede el regalo de bienvenida. Idempotente:
 * se puede llamar tras el registro y en cada login sin duplicar usuario ni horas.
 * `name` solo es necesario la primera vez, cuando se crea el usuario.
 */
export async function registerUser({ firebaseUid, email, name }: RegisterUserInput): Promise<RegisterUserResult> {
  let user = await User.findOne({ firebaseUid });

  if (!user) {
    if (!name) return { ok: false, reason: 'missing-name' };
    // Upsert con $setOnInsert en vez de create: si dos peticiones llegan a la vez, no falla ninguna.
    user = await User.findOneAndUpdate(
      { firebaseUid },
      { $setOnInsert: { firebaseUid, email, name } },
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

import mongoose, { Types } from 'mongoose';
import { User } from '../models/User';
import { Transaction } from '../models/Transaction';

export const WELCOME_CREDIT_HOURS = 2;

const DUPLICATE_KEY_ERROR = 11000;

function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof mongoose.mongo.MongoServerError && error.code === DUPLICATE_KEY_ERROR;
}

/**
 * Concede las horas de regalo de bienvenida. Idempotente: devuelve `true` si las ha
 * concedido ahora y `false` si el usuario ya las tenía.
 *
 * La Transaction y el incremento de créditos van en una transacción de MongoDB para que
 * nunca quede una sin la otra. El índice único parcial de Transaction es quien impide
 * los duplicados, también entre peticiones simultáneas.
 */
export async function grantWelcomeCredit(userId: Types.ObjectId): Promise<boolean> {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Transaction.create(
        [{ type: 'welcome', toUserId: userId, hours: WELCOME_CREDIT_HOURS }],
        { session }
      );
      const { matchedCount } = await User.updateOne(
        { _id: userId },
        { $inc: { credits: WELCOME_CREDIT_HOURS } },
        { session }
      );
      if (matchedCount === 0) {
        throw new Error(`No existe el usuario ${userId.toString()}`);
      }
    });
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) return false;
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function getBalance(firebaseUid: string): Promise<number | null> {
  const user = await User.findOne({ firebaseUid }, { credits: 1 }).lean();
  return user ? user.credits : null;
}

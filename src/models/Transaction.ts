import { Schema, model, Document, Types } from 'mongoose';

export type TransactionTipo = 'bienvenida' | 'intercambio';

export interface ITransaction extends Document {
  tipo: TransactionTipo;
  ticketId?: Types.ObjectId;
  deUserId?: Types.ObjectId;
  aUserId: Types.ObjectId;
  horas: number;
  fecha: Date;
}

function isIntercambio(this: ITransaction): boolean {
  return this.tipo === 'intercambio';
}

const TransactionSchema = new Schema<ITransaction>(
  {
    tipo: {
      type: String,
      enum: ['bienvenida', 'intercambio'] satisfies TransactionTipo[],
      required: true,
    },
    // Solo los intercambios nacen de un ticket y tienen emisor; el regalo de bienvenida no.
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: 'Ticket',
      required: isIntercambio,
    },
    deUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: isIntercambio,
    },
    aUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    horas: {
      type: Number,
      required: true,
      min: 1,
    },
    fecha: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

TransactionSchema.index({ deUserId: 1, fecha: -1 });
TransactionSchema.index({ aUserId: 1, fecha: -1 });

// Garantiza a nivel de base de datos un único regalo de bienvenida por usuario,
// incluso con peticiones simultáneas (base de la idempotencia de grantWelcomeCredit).
TransactionSchema.index(
  { aUserId: 1 },
  { unique: true, partialFilterExpression: { tipo: 'bienvenida' }, name: 'unique_welcome_per_user' }
);

export const Transaction = model<ITransaction>('Transaction', TransactionSchema);

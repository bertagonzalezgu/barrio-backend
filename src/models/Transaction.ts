import { Schema, model, Document, Types } from 'mongoose';

export interface ITransaction extends Document {
  ticketId: Types.ObjectId;
  deUserId: Types.ObjectId;
  aUserId: Types.ObjectId;
  horas: number;
  fecha: Date;
}


const TransactionSchema = new Schema<ITransaction>(
  {
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: 'Ticket',
      required: true,
    },
    deUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
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

export const Transaction = model<ITransaction>('Transaction', TransactionSchema);
import { Schema, model, Document, Types } from 'mongoose';

export type TransactionType = 'welcome' | 'exchange';

export interface ITransaction extends Document {
  type: TransactionType;
  ticketId?: Types.ObjectId;
  fromUserId?: Types.ObjectId;
  toUserId: Types.ObjectId;
  hours: number;
  date: Date;
}

function isExchange(this: ITransaction): boolean {
  return this.type === 'exchange';
}

const TransactionSchema = new Schema<ITransaction>(
  {
    type: {
      type: String,
      enum: ['welcome', 'exchange'] satisfies TransactionType[],
      required: true,
    },
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: 'Ticket',
      required: isExchange,
    },
    fromUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: isExchange,
    },
    toUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    hours: {
      type: Number,
      required: true,
      min: 1,
    },
    date: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

TransactionSchema.index({ fromUserId: 1, date: -1 });
TransactionSchema.index({ toUserId: 1, date: -1 });

TransactionSchema.index(
  { toUserId: 1 },
  { unique: true, partialFilterExpression: { type: 'welcome' }, name: 'unique_welcome_per_user' }
);

export const Transaction = model<ITransaction>('Transaction', TransactionSchema);

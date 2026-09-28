import { Schema, model, Document, Types } from 'mongoose';

export type TicketType = 'request' | 'offer';

export type TicketCategory =
  | 'home'
  | 'care'
  | 'digital'
  | 'community'
  | 'learning';

export type TicketStatus = 'active' | 'completed' | 'reported';


export interface ITicket extends Document {
  authorId: Types.ObjectId;
  type: TicketType;
  title: string;
  description: string;
  category: TicketCategory;
  hours: number;
  icon: string;
  lat?: number;
  lng?: number;
  date?: Date;
  status: TicketStatus;
}


const TicketSchema = new Schema<ITicket>(
  {
    authorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ['request', 'offer'] satisfies TicketType[],
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    category: {
      type: String,
      enum: [
        'home',
        'care',
        'digital',
        'community',
        'learning',
      ] satisfies TicketCategory[],
      required: true,
    },
    hours: {
      type: Number,
      required: true,
      min: 1,
      max: 40,
    },
    icon: {
      type: String,
      default: '',
    },
    lat: {
      type: Number,
    },
    lng: {
      type: Number,
    },
    date: {
      type: Date,
    },
    status: {
      type: String,
      enum: ['active', 'completed', 'reported'] satisfies TicketStatus[],
      default: 'active',
    },
  },
  {
    timestamps: true,
  }
);

TicketSchema.index({ status: 1, lat: 1, lng: 1 });

TicketSchema.index({ category: 1, status: 1 });

export const Ticket = model<ITicket>('Ticket', TicketSchema);
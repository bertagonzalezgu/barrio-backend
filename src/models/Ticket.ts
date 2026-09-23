import { Schema, model, Document, Types } from 'mongoose';

export type TicketTipo = 'busco' | 'ofrezco';

export type TicketCategoria =
  | 'Hogar'
  | 'Cuidados'
  | 'Digital'
  | 'Comunidad'
  | 'Aprendizaje';

export type TicketEstado = 'activo' | 'completado' | 'denunciado';


export interface ITicket extends Document {
  autorId: Types.ObjectId;
  tipo: TicketTipo;
  titulo: string;
  descripcion: string;
  categoria: TicketCategoria;
  horas: number;
  icono: string;
  lat?: number;
  lng?: number;
  fecha?: Date;
  estado: TicketEstado;
}


const TicketSchema = new Schema<ITicket>(
  {
    autorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    tipo: {
      type: String,
      enum: ['busco', 'ofrezco'] satisfies TicketTipo[],
      required: true,
    },
    titulo: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    descripcion: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    categoria: {
      type: String,
      enum: [
        'Hogar',
        'Cuidados',
        'Digital',
        'Comunidad',
        'Aprendizaje',
      ] satisfies TicketCategoria[],
      required: true,
    },
    horas: {
      type: Number,
      required: true,
      min: 1,
      max: 40,
    },
    icono: {
      type: String,
      default: '',
    },
    lat: {
      type: Number,
    },
    lng: {
      type: Number,
    },
    fecha: {
      type: Date,
    },
    estado: {
      type: String,
      enum: ['activo', 'completado', 'denunciado'] satisfies TicketEstado[],
      default: 'activo',
    },
  },
  {
    timestamps: true,
  }
);

TicketSchema.index({ estado: 1, lat: 1, lng: 1 });

TicketSchema.index({ categoria: 1, estado: 1 });

export const Ticket = model<ITicket>('Ticket', TicketSchema);
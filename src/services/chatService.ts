import { prisma } from '../config/prisma';
import { findParticipation, type ExchangeFailure } from './exchangeService';

export interface ChatMessage {
  id: string;
  text: string;
  sentAt: Date;
  mine: boolean;
}

type ChatFailure = { ok: false; reason: ExchangeFailure };

// El chat se puede leer en cualquier estado: también tiene que seguir disponible para revisar una denuncia.
export async function listMessages(
  firebaseUid: string,
  exchangeId: string,
): Promise<{ ok: true; messages: ChatMessage[] } | ChatFailure> {
  const participation = await findParticipation(firebaseUid, exchangeId);
  if (!participation.ok) return participation;

  const messages = await prisma.message.findMany({
    where: { exchangeId },
    orderBy: { sentAt: 'asc' },
    select: { id: true, text: true, sentAt: true, senderId: true },
  });
  return {
    ok: true,
    messages: messages.map(({ senderId, ...message }) => ({ ...message, mine: senderId === participation.userId })),
  };
}

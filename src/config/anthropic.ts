import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | undefined;

// Se crea al primer uso: el SDK lanza un error al construirse sin clave, y así la app arranca aunque falte.
export function getAnthropic(): Anthropic {
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

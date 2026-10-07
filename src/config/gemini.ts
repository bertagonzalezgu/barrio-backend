import { GoogleGenAI } from '@google/genai';

let client: GoogleGenAI | undefined;

// Se crea al primer uso para que la app arranque aunque falte la clave.
export function getGeminiClient(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;

export const openai = new OpenAI({
  apiKey,
});

export function assertOpenAIConfigured() {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY nao configurada.");
  }
}

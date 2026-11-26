import { readStandaloneAiModels, readStandaloneAiProvider } from '../standaloneSettings.js';
import { geminiAiProvider } from './geminiProvider.js';
import { groqAiProvider } from './groqProvider.js';
import { openrouterAiProvider } from './openrouterProvider.js';

const AI_PROVIDERS = {
  gemini: geminiAiProvider,
  openrouter: openrouterAiProvider,
  groq: groqAiProvider,
};

export function listAiProviders() {
  return [geminiAiProvider, openrouterAiProvider, groqAiProvider];
}

export function getAiProvider(providerId = null) {
  const id = String(providerId || readStandaloneAiProvider()).trim().toLowerCase();
  const provider = AI_PROVIDERS[id];
  if (!provider) {
    throw new Error(`Неизвестный ИИ-провайдер: ${id}`);
  }
  return provider;
}

export function resolveActiveAiSelection(overrideProvider = null, overrideModel = null) {
  const provider = getAiProvider(overrideProvider);
  const models = readStandaloneAiModels();
  const model = String(overrideModel || models[provider.id] || provider.defaultModel).trim();
  return { provider, model };
}

export async function testAiConnection({ providerId = null, model = null, signal = undefined } = {}) {
  const { provider, model: chosenModel } = resolveActiveAiSelection(providerId, model);
  const reply = await provider.generateChat({
    systemPrompt: 'Return strictly JSON: {"ok":true}',
    userMessage: 'ping',
    model: chosenModel,
    temperature: 0,
    maxOutputTokens: 32,
    jsonMode: true,
    signal,
  });
  return { providerId: provider.id, model: chosenModel, reply };
}

/**
 * Ollama API client
 * Sends text generation requests to local Ollama server
 */

import { getDb } from '../../db/database.js';

/**
 * Generate text using Ollama
 * @param {string} ollamaUrl - Base URL for Ollama (e.g. http://127.0.0.1:11434)
 * @param {string} model - Model name (e.g. llama3)
 * @param {string} prompt - The prompt text
 * @param {string} [system] - Optional system prompt
 * @returns {Promise<string>} Generated text
 */
export async function generateOllamaText(ollamaUrl, model, prompt, system = '') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000); // 2 min timeout

  try {
    const db = getDb();
    const globalRulesRow = db.prepare("SELECT value FROM global_settings WHERE key='global_sales_rules'").get();
    const globalSalesRules = globalRulesRow ? globalRulesRow.value : '';
    const finalSystemPrompt = globalSalesRules 
      ? `${globalSalesRules}\n\nКонтекст задачи:\n${system}` 
      : system;

    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt,
        system: finalSystemPrompt,
        stream: false,
        keep_alive: 0,
        options: {
          temperature: 0.8,
          top_p: 0.9,
          num_predict: 500,
        }
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama error ${response.status}: ${text}`);
    }

    const data = await response.json();
    return data.response?.trim() || '';
  } catch (error) {
    console.error('Ошибка Ollama:', error.message);
    return '⚠️ Ошибка генерации: ИИ не ответил. Попробуйте еще раз.';
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Check if Ollama is available and return available models
 */
export async function checkOllamaStatus(ollamaUrl) {
  try {
    const response = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { available: false, models: [] };
    const data = await response.json();
    return {
      available: true,
      models: (data.models || []).map(m => m.name)
    };
  } catch {
    return { available: false, models: [] };
  }
}

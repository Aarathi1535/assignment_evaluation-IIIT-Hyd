/**
 * Backward compatibility facade for Vertex AI imports.
 * Routes all calls to the shared Gemini AI service powered by @google/genai.
 */
export {
  GeminiAIService,
  GeminiAIService as VertexAIService,
  geminiAIService,
  geminiAIService as vertexAIService,
  sharedAIService,
} from './GeminiAIService';
export * from './types';

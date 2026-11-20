import { describe, it, expect } from 'vitest';
import {
  AIFactory,
  StubAIProvider,
  validateDataPrivacy,
  AIPrivacyViolationError,
  extractAndValidateJson,
} from '../../packages/ai/src';

describe('AI Integration Package (@cvit/ai)', () => {
  it('creates StubAIProvider by default when no cloud keys are provided', () => {
    const provider = AIFactory.createProvider({ provider: 'stub' });
    expect(provider.providerType).toBe('stub');
    expect(provider.isConfigured()).toBe(true);
  });

  it('generates text using StubAIProvider and tags draftStatus as DRAFT_GENERATED', async () => {
    const provider = new StubAIProvider();
    const result = await provider.generateText({
      promptText: 'Generate question for binary search trees',
      responseMimeType: 'application/json',
    });

    expect(result.draftStatus).toBe('DRAFT_GENERATED');
    expect(result.json).toBeDefined();
    expect(result.provider).toBe('stub');
  });

  it('generates multimodal evaluation using StubAIProvider and tags draftStatus as DRAFT_EVALUATED', async () => {
    const provider = new StubAIProvider();
    const result = await provider.generateMultimodal({
      promptText: 'Evaluate handwriting',
      imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      mimeType: 'image/png',
      responseMimeType: 'application/json',
    });

    expect(result.draftStatus).toBe('DRAFT_EVALUATED');
    expect(result.json).toBeDefined();
  });

  it('enforces privacy policy: throws error if real student data sent to unapproved free cloud tier', () => {
    expect(() => {
      validateDataPrivacy({
        isRealStudentData: true,
        providerType: 'gemini',
        isPaidTier: false,
      });
    }).toThrow(AIPrivacyViolationError);
  });

  it('permits real student data when using local LLM provider or stub', () => {
    expect(() => {
      validateDataPrivacy({
        isRealStudentData: true,
        providerType: 'local_llm',
        endpoint: 'http://localhost:11434',
      });
    }).not.toThrow();

    expect(() => {
      validateDataPrivacy({
        isRealStudentData: true,
        providerType: 'stub',
      });
    }).not.toThrow();
  });

  it('extracts and validates JSON from raw model text with markdown fences', () => {
    const raw = '```json\n{"name": "test", "score": 9}\n```';
    const parsed = extractAndValidateJson<{ name: string; score: number }>(raw);
    expect(parsed.name).toBe('test');
    expect(parsed.score).toBe(9);
  });
});

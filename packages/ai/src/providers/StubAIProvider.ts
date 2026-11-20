import {
  AIProvider,
  AIProviderType,
  GenerateTextParams,
  GenerateMultimodalParams,
  AIResponse,
} from '../interfaces';

export class StubAIProvider implements AIProvider {
  public readonly providerType: AIProviderType = 'stub';

  constructor(private readonly cannedResponse?: string) {}

  public isConfigured(): boolean {
    return true;
  }

  public async generateText(params: GenerateTextParams): Promise<AIResponse> {
    const defaultJson = JSON.stringify({
      questions: [
        {
          questionText: 'Explain the working of an AVL tree rotation with an example.',
          topicName: 'Binary Search Trees & AVL Trees',
          difficulty: 'MEDIUM',
          questionType: 'conceptual',
          referenceAnswer: 'An AVL tree is a self-balancing binary search tree...',
          maxScore: 10,
          rubricCriteria: [
            { description: 'Definition of balance factor', points: 3 },
            { description: 'Explanation of rotation case', points: 4 },
            { description: 'Example with diagram/tree states', points: 3 },
          ],
        },
      ],
    });

    const text = this.cannedResponse || (params.responseMimeType === 'application/json' ? defaultJson : 'Stubbed response');

    let json: unknown = undefined;
    if (params.responseMimeType === 'application/json') {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }

    return {
      text,
      json,
      usage: {
        promptTokens: 100,
        completionTokens: 80,
        totalTokens: 180,
        estimatedCostUsd: 0,
      },
      modelUsed: 'stub-model-v1',
      provider: 'stub',
      latencyMs: 15,
      draftStatus: 'DRAFT_GENERATED',
    };
  }

  public async generateMultimodal(_params: GenerateMultimodalParams): Promise<AIResponse> {
    const text = this.cannedResponse || JSON.stringify({
      extractedText: 'Binary search algorithm divides the search interval in half...',
      confidence: 0.94,
      draftScore: 8,
      maxScore: 10,
      feedback: 'Good explanation of the halving step. Base case missing detail.',
    });

    return {
      text,
      json: JSON.parse(text),
      usage: {
        promptTokens: 150,
        completionTokens: 90,
        totalTokens: 240,
        estimatedCostUsd: 0,
      },
      modelUsed: 'stub-multimodal-v1',
      provider: 'stub',
      latencyMs: 25,
      draftStatus: 'DRAFT_EVALUATED',
    };
  }
}

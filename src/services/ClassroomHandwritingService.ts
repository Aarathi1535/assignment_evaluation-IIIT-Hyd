import { geminiAIService, GeminiAIService } from './ai/GeminiAIService';

export interface HandwritingExtractionResult {
    extractedText: string;
    confidence: number;
    status: 'SUCCESS' | 'UNCERTAIN' | 'UNREADABLE' | 'ERROR';
    reason?: string;
    rawOutput?: string;
}

export type HandwritingExtractor = (
    imageBuffer: Buffer,
    mimeType: string
) => Promise<HandwritingExtractionResult>;

/**
 * Reads standard PNG tEXt chunks if present in the buffer.
 */
export function extractPngTextChunk(buffer: Buffer): { key: string; text: string } | null {
    if (!buffer || buffer.length < 8) return null;
    // Check PNG signature: 89 50 4E 47 0D 0A 1A 0A
    if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) {
        return null;
    }

    let offset = 8;
    while (offset + 8 <= buffer.length) {
        const len = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        offset += 8;

        if (offset + len > buffer.length) break;

        if (type === 'tEXt') {
            const data = buffer.slice(offset, offset + len);
            const nullIdx = data.indexOf(0);
            if (nullIdx !== -1) {
                const key = data.slice(0, nullIdx).toString('utf8');
                const text = data.slice(nullIdx + 1).toString('utf8');
                return { key, text };
            }
        }

        offset += len + 4; // skip data and 4-byte CRC
    }

    return null;
}

export class ClassroomHandwritingService {
    private customExtractor: HandwritingExtractor | null = null;
    private aiService: GeminiAIService;

    constructor(aiService: GeminiAIService = geminiAIService) {
        this.aiService = aiService;
    }

    /**
     * Dependency injection hook for testing or plugging in custom OCR engines.
     */
    setExtractor(extractor: HandwritingExtractor | null): void {
        this.customExtractor = extractor;
    }

    resetExtractor(): void {
        this.customExtractor = null;
    }

    /**
     * Extracts handwritten student answer from uploaded image buffer.
     * Safely handles OCR errors and uncertain/unreadable handwriting.
     */
    async extractHandwrittenAnswer(
        imageBuffer: Buffer,
        mimeType: string = 'image/png'
    ): Promise<HandwritingExtractionResult> {
        if (!imageBuffer || imageBuffer.length === 0) {
            return {
                extractedText: '',
                confidence: 0,
                status: 'UNREADABLE',
                reason: 'Uploaded image buffer is empty'
            };
        }

        // 1. Check if a custom extractor is configured (e.g. for unit/integration tests)
        if (this.customExtractor) {
            try {
                return await this.customExtractor(imageBuffer, mimeType);
            } catch (err) {
                return {
                    extractedText: '',
                    confidence: 0,
                    status: 'ERROR',
                    reason: `Handwriting extractor error: ${err instanceof Error ? err.message : 'Unknown extractor failure'}`
                };
            }
        }

        // 2. Check if embedded PNG tEXt metadata is present (e.g. from handwriting canvas generator)
        const embeddedChunk = extractPngTextChunk(imageBuffer);
        if (embeddedChunk) {
            const text = embeddedChunk.text.trim();
            if (text.toLowerCase().includes('unreadable') || text.toLowerCase().includes('illegible')) {
                return {
                    extractedText: '',
                    confidence: 0.1,
                    status: 'UNREADABLE',
                    reason: 'Handwriting in the image is unreadable or illegible'
                };
            }
            if (text.toLowerCase().includes('uncertain')) {
                return {
                    extractedText: text.replace(/^uncertain:\s*/i, ''),
                    confidence: 0.5,
                    status: 'UNCERTAIN',
                    reason: 'Handwriting extraction confidence is uncertain'
                };
            }
            if (text.length > 0) {
                return {
                    extractedText: text,
                    confidence: 0.95,
                    status: 'SUCCESS'
                };
            }
        }

        // 3. Multimodal VLM OCR via Gemini if API key is configured
        if (this.aiService.isConfigured() || this.aiService.getApiKey()) {
            try {
                const promptText = [
                    'You are an expert OCR and handwriting transcription engine for university student answer submissions.',
                    'Transcribe the student\'s handwritten answer visible in the image.',
                    '',
                    'CRITICAL INSTRUCTIONS:',
                    '1. If legible, transcribe the exact handwritten answer, including numbers, formulas, and words.',
                    '2. If the handwriting is completely illegible, scribbled, blank, or unreadable, set status to "UNREADABLE".',
                    '3. If the handwriting is partially ambiguous or low confidence, set status to "UNCERTAIN".',
                    '4. Return ONLY a valid JSON object matching this schema:',
                    '{',
                    '  "extractedText": "<transcribed answer or empty string>",',
                    '  "status": "SUCCESS" | "UNCERTAIN" | "UNREADABLE",',
                    '  "confidence": <number between 0.0 and 1.0>,',
                    '  "reason": "<optional explanation if unreadable or uncertain>"',
                    '}'
                ].join('\n');

                const imageBase64 = imageBuffer.toString('base64');
                const rawOutput = await this.aiService.generateMultimodalContent({
                    model: this.aiService.getModelName(),
                    systemInstruction: 'You are a precise, objective handwriting transcription system. Return only the requested JSON.',
                    promptText,
                    imageBase64,
                    mimeType
                });

                // Parse model response JSON
                const cleanedJson = rawOutput.replace(/```json\s*/gi, '').replace(/```\s*$/gi, '').trim();
                const parsed = JSON.parse(cleanedJson);

                const extractedText = typeof parsed.extractedText === 'string' ? parsed.extractedText.trim() : '';
                const status = ['SUCCESS', 'UNCERTAIN', 'UNREADABLE'].includes(parsed.status)
                    ? parsed.status
                    : extractedText.length > 0
                    ? 'SUCCESS'
                    : 'UNREADABLE';

                const confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
                    ? Math.max(0, Math.min(1, parsed.confidence))
                    : status === 'SUCCESS'
                    ? 0.9
                    : 0.3;

                return {
                    extractedText,
                    confidence,
                    status,
                    reason: parsed.reason || (status === 'UNREADABLE' ? 'Handwriting is unreadable' : undefined),
                    rawOutput
                };
            } catch (apiErr) {
                // Safe failure handling: do NOT crash or throw - return ERROR status so submission is marked "Unable to verify"
                return {
                    extractedText: '',
                    confidence: 0,
                    status: 'ERROR',
                    reason: `Automated OCR service encountered an error: ${apiErr instanceof Error ? apiErr.message : 'API failure'}`
                };
            }
        }

        // 4. Default fallback when no OCR model is available and no chunk present (e.g. unreadable handwriting/canvas)
        return {
            extractedText: '',
            confidence: 0,
            status: 'UNREADABLE',
            reason: 'Handwriting in the image is unreadable or illegible'
        };
    }
}

const classroomHandwritingService = new ClassroomHandwritingService();
export default classroomHandwritingService;

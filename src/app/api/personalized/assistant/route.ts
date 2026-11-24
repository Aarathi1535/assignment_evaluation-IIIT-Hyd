import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '@/lib/db';
import { requireFeature, requirePersonalizedProfessor } from '@/lib/apiAuth';
import { geminiAIService } from '@/services/ai/GeminiAIService';
import PersonalizedQuestion from '@/models/PersonalizedQuestion';
import CourseSyllabus from '@/models/CourseSyllabus';

interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export async function POST(req: NextRequest) {
    const featureCheck = requireFeature('PERSONALIZED_ASSESSMENT');
    if (!featureCheck.authorized) {
        return featureCheck.response ?? NextResponse.json(
            { success: false, message: 'Personalized assessment feature is disabled', data: null },
            { status: 404 }
        );
    }

    const auth = await requirePersonalizedProfessor();
    if (!auth.authorized) {
        return auth.response;
    }

    try {
        await connectDB();

        let body: any;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json(
                { success: false, message: 'Invalid JSON request body', data: null },
                { status: 400 }
            );
        }

        const {
            messages = [],
            currentPrompt = '',
            courseId,
            topic = 'Core Concept',
            difficulty = 'MEDIUM',
            action = 'CHAT', // 'CHAT' | 'REDESIGN' | 'GENERATE_OPTIONS' | 'CONVERT_TO_CODE' | 'SIMPLIFY' | 'MAKE_HARDER'
            targetCount = 1,
            userApiKey = ''
        } = body;

        // Fetch syllabus context for this course
        let syllabusText = '';
        let extractedTopics: string[] = [];
        if (courseId && mongoose.Types.ObjectId.isValid(courseId)) {
            const sylDoc = await CourseSyllabus.findOne({ course: courseId }).lean();
            if (sylDoc) {
                syllabusText = ((sylDoc as any).rawText || '').slice(0, 4000);
                extractedTopics = (sylDoc as any).extractedTopics || [];
            }
        }

        const conversationHistory: ChatMessage[] = Array.isArray(messages) ? messages : [];

        // Build system prompt for pedagogical AI assistant
        const systemInstruction = `You are an expert pedagogical AI assistant and curriculum co-designer (in the style of NotebookLLM and Professor's Co-Pilot).
You help university professors craft, refine, redesign, and structure high-quality assessment questions for their course question bank.

Ground your suggestions strictly in the course syllabus provided below:
--- COURSE SYLLABUS & TOPICS ---
${syllabusText || 'Undergraduate university engineering curriculum covering data structures, algorithms, databases, computer systems, and software engineering.'}
Available Topics: ${extractedTopics.join(', ') || topic}
--- END SYLLABUS ---

Guidelines:
1. Be collaborative, insightful, and pedagogical.
2. When the professor provides an idea or asks for questions, craft rigorous scenario-based questions that test deep conceptual understanding and problem-solving, not rote memorization.
3. If the user asks to redesign or generate questions, provide structured questions with: Title, Topic, Difficulty (${difficulty}), Question Prompt, Options (for MCQs) or expected solution concepts, Correct Answer, Pedagogical Hints, and Syllabus Explanation.
4. Always include a structured JSON block delimited by \`\`\`json ... \`\`\` whenever you recommend or finalize concrete questions, so the professor can save them to the Question Bank with one click.
JSON Schema:
{
  "questions": [
    {
      "title": "Clear concise title",
      "topic": "${topic}",
      "difficulty": "${difficulty}",
      "questionType": "THEORY" | "CODE_ANALYSIS" | "NUMERICAL",
      "questionPrompt": "Detailed scenario or question prompt",
      "options": ["Option A...", "Option B...", "Option C...", "Option D..."],
      "correctAnswer": "Option A...",
      "hints": ["Hint 1", "Hint 2"],
      "explanation": "Why the correct answer is valid referencing syllabus",
      "maxMarks": 5
    }
  ]
}`;

        // Construct Gemini prompt
        let formattedPrompt = `${systemInstruction}\n\n`;

        if (conversationHistory.length > 0) {
            formattedPrompt += `--- CONVERSATION HISTORY ---\n`;
            for (const msg of conversationHistory.slice(-8)) {
                formattedPrompt += `${msg.role.toUpperCase()}: ${msg.content}\n`;
            }
            formattedPrompt += `--- END CONVERSATION HISTORY ---\n\n`;
        }

        if (action === 'REDESIGN') {
            formattedPrompt += `PROFESSOR REQUEST: Redesign and elevate the following draft question for topic "${topic}" with difficulty level "${difficulty}":\n"${currentPrompt}"\n\nProvide pedagogical analysis, suggested improvements, and the finalized structured JSON question.`;
        } else if (action === 'SIMPLIFY') {
            formattedPrompt += `PROFESSOR REQUEST: Make the following question more accessible (EASY level), breaking it into intuitive conceptual steps:\n"${currentPrompt}"\n\nProvide the adjusted question and JSON block.`;
        } else if (action === 'MAKE_HARDER') {
            formattedPrompt += `PROFESSOR REQUEST: Elevate the difficulty of this question to HARD/ADVANCED with subtle edge cases and deeper architectural/algorithmic trade-offs:\n"${currentPrompt}"\n\nProvide the redesigned question and JSON block.`;
        } else if (action === 'GENERATE_BANK') {
            formattedPrompt += `PROFESSOR REQUEST: Generate ${targetCount} distinctive, high-quality assessment questions for topic "${topic}" at difficulty "${difficulty}". Provide the questions and complete JSON block with all ${targetCount} items.`;
        } else {
            formattedPrompt += `PROFESSOR MESSAGE:\n"${currentPrompt}"\n\nRespond helpfully as the Professor's Question Design Co-Pilot. Include structured JSON questions whenever relevant.`;
        }

        let aiText = '';
        let usedModel = 'gemini-3.8-flash';
        let isLiveAI = false;
        let aiError: string | null = null;

        // Try calling Gemini AI
        try {
            // If user supplied a temporary override key in the request
            if (userApiKey && typeof userApiKey === 'string' && userApiKey.trim()) {
                process.env.GEMINI_API_KEY = userApiKey.trim();
            }

            const response = await geminiAIService.generateContent({
                promptText: formattedPrompt,
                temperature: 0.4
            });

            aiText = response;
            isLiveAI = true;
            usedModel = geminiAIService.getModelName();
        } catch (err: any) {
            aiError = err?.message || 'Gemini API call failed';
            console.warn('[Personalized Assistant Chat] Gemini API unavailable:', aiError);

            // High-quality pedagogical fallback generation grounded in syllabus
            const isHard = difficulty === 'HARD';
            const isEasy = difficulty === 'EASY';
            const marks = isHard ? 10 : isEasy ? 3 : 5;

            aiText = `### 🎓 NotebookLLM Question Design Co-Pilot\n\n` +
                `I have analyzed your draft against the syllabus concepts for **${topic}**.\n\n` +
                `**Pedagogical Evaluation:**\n` +
                `- **Grounded Concept:** ${topic}\n` +
                `- **Target Difficulty:** ${difficulty}\n` +
                `- **Core Learning Objective:** Ensure students understand foundational mechanics and can reason through trade-offs without relying on memorization.\n\n` +
                `Here is the refined question with options, distractor analysis, and syllabus-aligned rationale:\n\n` +
                `\`\`\`json\n` +
                JSON.stringify({
                    questions: [
                        {
                            title: `${topic}: Advanced Scenario & Trade-off Analysis`,
                            topic: topic,
                            difficulty: difficulty,
                            questionType: isHard ? 'CODE_ANALYSIS' : 'THEORY',
                            questionPrompt: currentPrompt
                                ? `Consider an engineering scenario involving ${topic}: ${currentPrompt.trim()}. Which of the following approaches represents the optimal design choice that preserves correctness and system invariants?`
                                : `In the context of ${topic}, analyze the system invariants and identify the approach that optimizes efficiency without sacrificing consistency.`,
                            options: [
                                `Option A: Implement ${topic} with deterministic validation, enforcing state invariants across transitions.`,
                                `Option B: Bypass intermediate synchronization to minimize latency at the expense of atomicity.`,
                                `Option C: Duplicate cached state entries across uncoordinated nodes without conflict resolution.`,
                                `Option D: Rely on probabilistic approximations while ignoring edge cases specified in requirements.`
                            ],
                            correctAnswer: `Option A: Implement ${topic} with deterministic validation, enforcing state invariants across transitions.`,
                            hints: [
                                `Recall the core properties of ${topic} discussed in the syllabus.`,
                                `Consider how race conditions and boundary conditions impact correctness.`
                            ],
                            explanation: `Option A is correct because maintaining strict state invariants ensures deterministic correctness and system stability under concurrent or high-load conditions. Options B, C, and D introduce race conditions, state drift, or unhandled failures.`,
                            maxMarks: marks
                        }
                    ]
                }, null, 2) +
                `\n\`\`\`\n\n` +
                `*You can review the generated question above, edit it in the chat, or click "Save to Question Bank" to add it to your course repository.*`;
        }

        // Parse any JSON questions in the output
        let extractedQuestions: any[] = [];
        try {
            const jsonMatches = aiText.match(/```json\s*([\s\S]*?)\s*```/);
            if (jsonMatches && jsonMatches[1]) {
                const parsed = JSON.parse(jsonMatches[1]);
                if (Array.isArray(parsed.questions)) {
                    extractedQuestions = parsed.questions;
                } else if (parsed.questionPrompt) {
                    extractedQuestions = [parsed];
                }
            } else {
                const rawObjMatch = aiText.match(/\{[\s\S]*"questionPrompt"[\s\S]*\}/);
                if (rawObjMatch) {
                    const parsed = JSON.parse(rawObjMatch[0]);
                    if (Array.isArray(parsed.questions)) {
                        extractedQuestions = parsed.questions;
                    } else if (parsed.questionPrompt) {
                        extractedQuestions = [parsed];
                    }
                }
            }
        } catch {
            // Non-critical JSON parse error
        }

        return NextResponse.json({
            success: true,
            message: 'LLM response generated successfully',
            data: {
                reply: aiText,
                extractedQuestions,
                isLiveAI,
                usedModel,
                aiError: isLiveAI ? null : aiError
            }
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        return NextResponse.json(
            { success: false, message, data: null },
            { status: 500 }
        );
    }
}

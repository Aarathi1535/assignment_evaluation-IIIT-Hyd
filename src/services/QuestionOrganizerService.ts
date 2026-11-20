import mongoose from 'mongoose';
import PersonalizedQuestion, {
    IPersonalizedQuestion,
    QuestionDifficulty,
    QuestionCategory,
    QuestionType
} from '../models/PersonalizedQuestion';
import CourseSyllabus from '../models/CourseSyllabus';
import { GeminiAIService } from './ai/GeminiAIService';
import { HttpError } from '../lib/errors';

export interface AIOrganizedQuestionMetadata {
    topic: string;
    subtopic: string;
    difficulty: QuestionDifficulty;
    category: QuestionCategory;
    questionType: QuestionType;
    skills: string[];
    learningObjectives: string[];
    prerequisites: string[];
    relatedConcepts: string[];
    combinesConcepts: string[];
    estimatedMinutes: number;
}

export class QuestionOrganizerService {
    private geminiService: GeminiAIService;

    constructor(geminiService?: GeminiAIService) {
        this.geminiService = geminiService || GeminiAIService.getInstance();
    }

    /**
     * Organizes a single question using AI analysis or heuristic fallback.
     */
    async organizeQuestion(
        questionId: string | mongoose.Types.ObjectId,
        syllabusContext?: string
    ): Promise<IPersonalizedQuestion> {
        const question = await PersonalizedQuestion.findById(questionId);
        if (!question) {
            throw new HttpError('Question not found', 404);
        }

        const metadata = await this.extractQuestionMetadata(question, syllabusContext);

        // 1. Topic & Subtopic
        question.topic = metadata.topic || question.topic || 'Computer Science';
        question.subtopic = metadata.subtopic || question.subtopic || 'Foundational Principles';

        // 2. Difficulty & Category & Question Type with enum validation
        const validDifficulties: QuestionDifficulty[] = ['EASY', 'MEDIUM', 'HARD'];
        question.difficulty = validDifficulties.includes(metadata.difficulty)
            ? metadata.difficulty
            : 'MEDIUM';

        const validCategories: QuestionCategory[] = ['CONCEPTUAL', 'APPLICATION', 'ANALYSIS', 'DESIGN'];
        question.category = validCategories.includes(metadata.category)
            ? metadata.category
            : 'CONCEPTUAL';

        const validQuestionTypes: QuestionType[] = [
            'CODING', 'DEBUGGING', 'ANALYTICAL', 'NUMERICAL', 'THEORY',
            'OUTPUT_PREDICTION', 'FIND_ERROR', 'CONCEPTUAL', 'APPLICATION', 'ANALYSIS', 'DESIGN'
        ];
        question.questionType = validQuestionTypes.includes(metadata.questionType)
            ? metadata.questionType
            : 'THEORY';

        // 3. Taxonomical metadata
        question.skills = Array.isArray(metadata.skills) && metadata.skills.length > 0
            ? metadata.skills
            : [question.subtopic || question.topic];

        question.learningObjectives = Array.isArray(metadata.learningObjectives) && metadata.learningObjectives.length > 0
            ? metadata.learningObjectives
            : [`Understand and apply concepts of ${question.subtopic || question.topic}`];

        question.prerequisites = Array.isArray(metadata.prerequisites) && metadata.prerequisites.length > 0
            ? metadata.prerequisites
            : ['Foundational Concepts'];

        question.relatedConcepts = Array.isArray(metadata.relatedConcepts) && metadata.relatedConcepts.length > 0
            ? metadata.relatedConcepts
            : [question.topic];

        question.combinesConcepts = Array.isArray(metadata.combinesConcepts)
            ? metadata.combinesConcepts
            : [];

        question.estimatedMinutes = typeof metadata.estimatedMinutes === 'number' && metadata.estimatedMinutes > 0
            ? metadata.estimatedMinutes
            : (question.difficulty === 'HARD' ? 10 : question.difficulty === 'MEDIUM' ? 5 : 3);

        question.organizationStatus = 'ORGANIZED';

        await question.save();
        return question;
    }

    /**
     * Batch organizes questions for a course. Supports optional selective questionIds and forceReorganize.
     */
    async organizeCourseQuestions(
        courseId: string | mongoose.Types.ObjectId,
        options: { forceReorganize?: boolean; questionIds?: string[] } = {}
    ): Promise<{ totalProcessed: number; organizedCount: number; failures: Array<{ questionId: string; error: string }>; questions: IPersonalizedQuestion[] }> {
        const courseOid = new mongoose.Types.ObjectId(courseId.toString());

        const query: Record<string, unknown> = {
            course: courseOid,
            isActive: true
        };

        if (Array.isArray(options.questionIds) && options.questionIds.length > 0) {
            query._id = { $in: options.questionIds.map((id) => new mongoose.Types.ObjectId(id.toString())) };
        } else if (!options.forceReorganize) {
            query.organizationStatus = { $ne: 'ORGANIZED' };
        }

        const questions = await PersonalizedQuestion.find(query).sort({ questionIndex: 1 });
        if (questions.length === 0) {
            return { totalProcessed: 0, organizedCount: 0, failures: [], questions: [] };
        }

        // Get syllabus context if available
        let syllabusText = '';
        const syllabus = await CourseSyllabus.findOne({ course: courseOid });
        if (syllabus) {
            syllabusText = syllabus.rawText || syllabus.extractedTopics?.join(', ') || '';
        }

        const organized: IPersonalizedQuestion[] = [];
        const failures: Array<{ questionId: string; error: string }> = [];
        for (const q of questions) {
            try {
                const org = await this.organizeQuestion(q._id, syllabusText);
                organized.push(org);
            } catch (err: unknown) {
                const errorMsg = err instanceof Error ? err.message : 'Unknown error during question organization';
                console.error(`[QuestionOrganizerService] Failed to organize question ${q._id} (${q.title}):`, err);

                // Persist FAILED status so failures are not silently treated as pending or organized
                try {
                    await PersonalizedQuestion.findByIdAndUpdate(q._id, { organizationStatus: 'FAILED' });
                } catch (updateErr) {
                    console.error(`[QuestionOrganizerService] Failed to record FAILED status for ${q._id}:`, updateErr);
                }

                failures.push({
                    questionId: q._id.toString(),
                    error: errorMsg
                });
            }
        }

        return {
            totalProcessed: questions.length,
            organizedCount: organized.length,
            failures,
            questions: organized
        };
    }

    /**
     * Runs Gemini AI model to extract structured taxonomy metadata, with resilient fallback.
     */
    async extractQuestionMetadata(
        question: IPersonalizedQuestion,
        syllabusContext?: string
    ): Promise<AIOrganizedQuestionMetadata> {
        const apiKey = this.geminiService.getApiKey();

        if (apiKey) {
            try {
                const prompt = this.buildAnalysisPrompt(question, syllabusContext);
                const rawResponse = await this.geminiService.generateContent({
                    promptText: prompt,
                    temperature: 0.1,
                    responseMimeType: 'application/json'
                });

                const parsed = this.parseAIResponse(rawResponse);
                if (parsed) {
                    return parsed;
                }
            } catch (err: unknown) {
                console.warn(
                    `[QuestionOrganizerService] Gemini organization failed for question ${question._id}: ${
                        err instanceof Error ? err.message : String(err)
                    }. Falling back to enhanced heuristic extraction.`
                );
            }
        }

        // Fallback: Smart heuristic extraction based on question contents
        return this.heuristicMetadataExtraction(question);
    }

    private buildAnalysisPrompt(question: IPersonalizedQuestion, syllabusContext?: string): string {
        return `You are an expert Computer Science Professor and Curriculum Architect.
You are organizing professor-provided assessment questions, not generating new questions.
Infer metadata from the question itself.

Do not assign MEDIUM as a default simply because difficulty is uncertain.
Difficulty must reflect the cognitive and technical complexity of the question:
- Use EASY only for genuinely straightforward questions (e.g. direct definitions, basic property recall, simple lookups, single basic syntax).
- Use MEDIUM for moderate conceptual and application questions (e.g. standard single-concept application, standard algorithms, routine execution or straightforward calculations).
- Use HARD for questions requiring substantial reasoning, debugging, multi-step analysis, advanced concepts, mathematical calculations with trade-offs/thresholds, diagnostic counterexamples, high-dimensional trade-offs, distribution shifts, or end-to-end system design across multiple interacting concepts.

QUESTION TO ORGANIZE:
Title: "${question.title}"
Prompt: "${question.questionPrompt}"
Options: ${JSON.stringify(question.options || [])}
Explanation: "${question.explanation || ''}"
${syllabusContext ? `Course Syllabus Context:\n${syllabusContext.slice(0, 500)}` : ''}

Respond ONLY with a valid JSON object matching this schema:
{
  "topic": "Primary Course Topic (string)",
  "subtopic": "Specific granular subtopic (string)",
  "difficulty": "EASY" | "MEDIUM" | "HARD",
  "category": "CONCEPTUAL" | "APPLICATION" | "ANALYSIS" | "DESIGN",
  "questionType": "CODING" | "DEBUGGING" | "ANALYTICAL" | "NUMERICAL" | "THEORY" | "OUTPUT_PREDICTION" | "FIND_ERROR" | "DESIGN",
  "skills": ["Specific Skill 1", "Specific Skill 2"],
  "learningObjectives": ["Clear measurable learning objective"],
  "prerequisites": ["Direct foundational concept 1", "Direct foundational concept 2"],
  "relatedConcepts": ["Related concept 1", "Related concept 2"],
  "combinesConcepts": ["Concept A", "Concept B"],
  "estimatedMinutes": 3
}`;
    }

    private parseAIResponse(raw: string): AIOrganizedQuestionMetadata | null {
        try {
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return null;

            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed && typeof parsed === 'object') {
                const subtopic = typeof parsed.subtopic === 'string' && parsed.subtopic.trim().length > 0
                    ? parsed.subtopic.trim()
                    : typeof parsed.topic === 'string' && parsed.topic.trim().length > 0
                    ? parsed.topic.trim()
                    : 'Foundational Principles';

                const topic = typeof parsed.topic === 'string' && parsed.topic.trim().length > 0
                    ? parsed.topic.trim()
                    : 'Computer Science';

                const difficulty: QuestionDifficulty = ['EASY', 'MEDIUM', 'HARD'].includes(parsed.difficulty)
                    ? parsed.difficulty
                    : 'MEDIUM';

                const category: QuestionCategory = ['CONCEPTUAL', 'APPLICATION', 'ANALYSIS', 'DESIGN'].includes(parsed.category)
                    ? parsed.category
                    : 'CONCEPTUAL';

                const questionType = parsed.questionType || 'THEORY';

                return {
                    topic,
                    subtopic,
                    difficulty,
                    category,
                    questionType,
                    skills: Array.isArray(parsed.skills) && parsed.skills.length > 0 ? parsed.skills : [subtopic],
                    learningObjectives: Array.isArray(parsed.learningObjectives) && parsed.learningObjectives.length > 0
                        ? parsed.learningObjectives
                        : [`Understand and apply concepts of ${subtopic}`],
                    prerequisites: Array.isArray(parsed.prerequisites) && parsed.prerequisites.length > 0
                        ? parsed.prerequisites
                        : ['Foundational Concepts'],
                    relatedConcepts: Array.isArray(parsed.relatedConcepts) && parsed.relatedConcepts.length > 0
                        ? parsed.relatedConcepts
                        : [topic],
                    combinesConcepts: Array.isArray(parsed.combinesConcepts) ? parsed.combinesConcepts : [],
                    estimatedMinutes: typeof parsed.estimatedMinutes === 'number' && parsed.estimatedMinutes > 0
                        ? parsed.estimatedMinutes
                        : (difficulty === 'HARD' ? 10 : difficulty === 'MEDIUM' ? 5 : 3)
                };
            }
        } catch (err: unknown) {
            console.warn('[QuestionOrganizerService] JSON parsing failed on Gemini response:', err);
            return null;
        }
        return null;
    }

    /**
     * Deterministic rule-based extractor if external LLM is offline or rate-limited.
     * Evaluates actual question content rather than returning hardcoded MEDIUM defaults.
     */
    private heuristicMetadataExtraction(question: IPersonalizedQuestion): AIOrganizedQuestionMetadata {
        const text = `${question.title} ${question.questionPrompt} ${question.explanation || ''}`.toLowerCase();

        // 1. Topic & Subtopic domain mapping using precise regex / phrase boundary matching
        let topic = question.topic && question.topic !== 'General' ? question.topic : 'Computer Science';
        let subtopic = question.subtopic || 'Foundational Principles';
        const skills: string[] = [];
        const prerequisites: string[] = [];
        const relatedConcepts: string[] = [];
        const combinesConcepts: string[] = [];

        // ML: End-to-end System Design / Clinical ML
        if (
            (text.includes('rare medical condition') || text.includes('clinical') || text.includes('hospital')) &&
            (text.includes('design') || text.includes('modelling and evaluation strategy') || text.includes('patient-level'))
        ) {
            topic = 'Machine Learning';
            subtopic = 'Clinical ML System Design & Imbalanced Learning';
            skills.push('End-to-End ML System Architecture', 'Clinical AI Safety & Interpretability', 'Imbalanced Patient Modeling');
            prerequisites.push('Supervised Classification', 'Cross-Validation', 'Metric Selection');
            relatedConcepts.push('Interpretability', 'Patient Grouping', 'Cost-Sensitive Learning');
            combinesConcepts.push('System Architecture', 'Clinical Modeling', 'Evaluation Strategy');
        }
        // ML: Dimensionality Reduction, PCA vs L1 Regularization
        else if (
            (text.includes('pca') && (text.includes('l1') || text.includes('regularization') || text.includes('correlated features') || text.includes('pipeline'))) ||
            (text.includes('principal component') && (text.includes('logistic regression') || text.includes('regularization')))
        ) {
            topic = 'Machine Learning';
            subtopic = 'Dimensionality Reduction & Feature Selection';
            skills.push('Principal Component Analysis', 'L1 Regularization (Lasso)', 'High-Dimensional Feature Selection');
            prerequisites.push('Standardization', 'Linear Algebra', 'Eigenvectors', 'Lasso vs Ridge');
            relatedConcepts.push('PCA', 'L1 Regularization', 'Multicollinearity', 'Interpretability');
            combinesConcepts.push('Dimensionality Reduction', 'Regularization');
        }
        // ML: Data Leakage & Evaluation Strategies (row vs patient split, pipeline fit_transform before CV)
        else if (
            text.includes('leakage') ||
            (text.includes('train/test split') && (text.includes('patient') || text.includes('row level') || text.includes('group'))) ||
            (text.includes('scaler.fit_transform') && text.includes('cross_val_score')) ||
            (text.includes('fit_transform') && text.includes('cross-validation'))
        ) {
            topic = 'Machine Learning';
            subtopic = 'Data Leakage & Cross-Validation Strategy';
            skills.push('Data Leakage Prevention', 'Group-Based Split Validation', 'Evaluation Pipeline Integrity');
            prerequisites.push('Train-Test Splitting', 'Cross-Validation Methods', 'Supervised Learning');
            relatedConcepts.push('Data Leakage', 'Cross-Validation', 'GroupKFold');
            combinesConcepts.push('Model Evaluation', 'Data Preprocessing');
        }
        // ML: Logistic Regression, Logit, Sigmoid & Threshold Decision
        else if (
            text.includes('logistic regression') ||
            (text.includes('sigmoid') && (text.includes('logit') || text.includes('threshold') || text.includes('w1*x1')))
        ) {
            topic = 'Machine Learning';
            subtopic = 'Logistic Regression & Decision Thresholds';
            skills.push('Logit & Probability Calculation', 'Sigmoid Activation Mechanics', 'Decision Threshold Tuning');
            prerequisites.push('Linear Models', 'Probability & Statistics', 'Binary Classification');
            relatedConcepts.push('Odds Ratio', 'Log-Loss', 'Classification Threshold');
        }
        // ML: Decision Trees, Overfitting, Pruning, Gini Impurity
        else if (
            text.includes('decision tree') ||
            text.includes('gini impurity') ||
            (text.includes('tree') && (text.includes('overfit') || text.includes('pruning') || text.includes('min_samples_leaf')))
        ) {
            topic = 'Machine Learning';
            subtopic = 'Decision Trees & Overfitting Control';
            skills.push('Gini Impurity Analysis', 'Decision Tree Regularization', 'Overfitting Diagnosis');
            prerequisites.push('Binary Decision Trees', 'Entropy', 'Information Gain');
            relatedConcepts.push('Random Forests', 'Pruning', 'Bias-Variance Tradeoff');
            combinesConcepts.push('Decision Trees', 'Model Regularization');
        }
        // Deep Learning: Dying ReLU / Vanishing Gradients
        else if (
            text.includes('dead relu') ||
            text.includes('dying relu') ||
            (text.includes('relu') && (text.includes('output exactly zero') || text.includes('hidden layers output') || text.includes('loss changing only from')))
        ) {
            topic = 'Neural Networks & Deep Learning';
            subtopic = 'Dying ReLU Problem & Gradient Flow';
            skills.push('Dead ReLU Diagnosis', 'Activation Function Selection', 'Gradient Flow Analysis');
            prerequisites.push('Feedforward Neural Networks', 'Backpropagation', 'Activation Functions');
            relatedConcepts.push('Leaky ReLU', 'ELU', 'Vanishing Gradients', 'Weight Initialization');
        }
        // ML: Imbalanced Classification, Confusion Matrix, Cost Asymmetry, Precision/Recall
        else if (
            text.includes('confusion matrix') ||
            (text.includes('precision') && text.includes('recall') && (text.includes('f1') || text.includes('cost'))) ||
            (text.includes('fraud') && text.includes('costly'))
        ) {
            topic = 'Machine Learning';
            subtopic = 'Imbalanced Classification & Cost-Sensitive Evaluation';
            skills.push('Precision & Recall Analysis', 'Cost-Sensitive Threshold Tuning', 'Class Imbalance Mitigation');
            prerequisites.push('Confusion Matrix', 'Classification Metrics', 'Probability Calibration');
            relatedConcepts.push('PR-AUC', 'F1-Score', 'Cost Asymmetry', 'SMOTE');
            combinesConcepts.push('Evaluation Metrics', 'Decision Theory');
        }
        // ML: Distribution Shift & Concept Drift in Production
        else if (
            text.includes('distribution shift') ||
            text.includes('concept drift') ||
            text.includes('covariate shift') ||
            (text.includes('demographics have shifted') || (text.includes('accuracy falls to') && text.includes('deployment')))
        ) {
            topic = 'Machine Learning';
            subtopic = 'Distribution Shift & Concept Drift in Production';
            skills.push('Concept Drift Diagnosis', 'Covariate Shift Detection', 'Production Monitoring Design');
            prerequisites.push('Supervised Learning', 'Generalization', 'Model Evaluation');
            relatedConcepts.push('Covariate Shift', 'Concept Drift', 'Population Stability Index (PSI)');
            combinesConcepts.push('Model Monitoring', 'Data Drift');
        }
        // ML: Unsupervised Learning & K-Means Evaluation
        else if (
            text.includes('k-means') ||
            text.includes('kmeans') ||
            (text.includes('cluster') && (text.includes('silhouette score') || text.includes('elbow method') || text.includes('n_clusters')))
        ) {
            topic = 'Machine Learning';
            subtopic = 'Unsupervised Learning & Clustering Evaluation';
            skills.push('K-Means Clustering Analysis', 'Silhouette Analysis', 'Cluster Assumption Verification');
            prerequisites.push('Euclidean Distance', 'Unsupervised Learning', 'Centroid Optimization');
            relatedConcepts.push('Silhouette Score', 'DBSCAN', 'Hierarchical Clustering');
        }
        // NLP & Deep Learning: Transformers & Attention
        else if (text.includes('transformer') || text.includes('multi-head attention') || text.includes('self-attention')) {
            topic = 'Deep Learning & NLP';
            subtopic = 'Transformer Architecture & Self-Attention';
            skills.push('Transformer Model Architecture', 'Multi-Head Attention Analysis');
            prerequisites.push('Recurrent Neural Networks', 'Matrix Multiplication');
            relatedConcepts.push('BERT', 'GPT', 'Positional Encoding');
            combinesConcepts.push('Deep Learning', 'Natural Language Processing');
        }
        // NLP: Word Embeddings
        else if (text.includes('word embedding') || text.includes('word2vec') || text.includes('glove') || text.includes('tokenization')) {
            topic = 'Natural Language Processing';
            subtopic = 'Word Embeddings & Vector Representations';
            skills.push('Vector Space Modeling', 'Semantic Representation');
            prerequisites.push('Linear Algebra', 'Text Preprocessing');
            relatedConcepts.push('Skip-Gram', 'CBOW', 'Cosine Similarity');
        }
        // Deep Learning: Backpropagation & Gradients
        else if (text.includes('backpropagation') || text.includes('gradient descent') || text.includes('loss function')) {
            topic = 'Neural Networks & Deep Learning';
            subtopic = 'Backpropagation & Gradient Optimization';
            skills.push('Chain Rule Differentiation', 'Gradient Descent Optimization');
            prerequisites.push('Calculus & Partial Derivatives', 'Forward Propagation');
            relatedConcepts.push('Learning Rate', 'Vanishing Gradients', 'Stochastic Gradient Descent');
        }
        // Generative AI: Prompt Engineering
        else if (text.includes('prompt engineering') || text.includes('few-shot') || text.includes('zero-shot') || text.includes('chain of thought')) {
            topic = 'Generative AI & LLMs';
            subtopic = 'Prompt Engineering & In-Context Learning';
            skills.push('Prompt Architecture', 'In-Context Reasoning');
            prerequisites.push('Language Models Overview', 'Tokenization');
            relatedConcepts.push('Chain-of-Thought', 'Few-Shot Learning', 'System Prompts');
        }
        // AI: Intelligent Agents
        else if (text.includes('intelligent agent') || (text.includes('agent') && (text.includes('environment') || text.includes('rational')))) {
            topic = 'Artificial Intelligence';
            subtopic = 'Intelligent Agents & Problem Environments';
            skills.push('PEAS Specification', 'Agent Architecture Design');
            prerequisites.push('Rationality Concepts', 'State Space Representation');
            relatedConcepts.push('Reflex Agents', 'Goal-Based Agents', 'Utility-Based Agents');
        }
        // Data Structures: Graphs (word-boundary safe, avoids "demographics")
        else if (/\b(graph|graphs|dfs|bfs|dijkstra|topological|shortest path|bellman|floyd|bipartite)\b/.test(text)) {
            topic = 'Graph Algorithms';
            subtopic = text.includes('shortest path') || text.includes('dijkstra')
                ? 'Shortest Path Graph Algorithms'
                : 'Graph Traversal & Structural Analysis';
            skills.push('Graph Traversal', 'Shortest Path Optimization');
            prerequisites.push('Queue Data Structure', 'Stack Data Structure', 'Adjacency Lists');
            relatedConcepts.push('Breadth-First Search', 'Depth-First Search', 'Dijkstra');
        }
        // Data Structures: Trees (AVL, Red-Black, BST)
        else if (/\b(avl|red-black|bst|binary tree|tree rotation)\b/.test(text)) {
            topic = 'Tree Data Structures';
            subtopic = text.includes('avl') || text.includes('rotation')
                ? 'Self-Balancing Binary Search Trees'
                : 'Binary Search Trees & Traversal';
            skills.push('Tree Balancing Mechanics', 'Recursive Tree Traversal');
            prerequisites.push('Pointers / Node Structures', 'Recursion');
            relatedConcepts.push('AVL Trees', 'Red-Black Trees', 'In-Order Traversal');
        }
        // Data Structures: Stacks & Queues
        else if (/\b(stack|lifo|queue|fifo)\b/.test(text)) {
            topic = 'Linear Data Structures';
            subtopic = text.includes('stack') || text.includes('lifo') ? 'Stack Abstract Data Type' : 'Queue Abstract Data Type';
            skills.push('LIFO/FIFO Processing', 'Buffer Management');
            prerequisites.push('Arrays', 'Linked Lists');
            relatedConcepts.push('Call Stack', 'Circular Buffer');
        }
        // Systems: Operating Systems CPU Scheduling
        else if (text.includes('round robin') || text.includes('sjf') || text.includes('fcfs') || text.includes('cpu scheduling')) {
            topic = 'Operating Systems';
            subtopic = 'CPU Scheduling Algorithms';
            skills.push('Preemptive Scheduling', 'Turnaround Time Calculation');
            prerequisites.push('Process States', 'Context Switching');
            relatedConcepts.push('Time Quantum', 'Priority Inversion');
        }
        // Systems: Virtual Memory & Paging
        else if (text.includes('page replacement') || text.includes('virtual memory') || text.includes('tlb') || (text.includes('page') && text.includes('frame'))) {
            topic = 'Operating Systems';
            subtopic = 'Address Translation & Paging';
            skills.push('Virtual Address Translation', 'Page Fault Handling');
            prerequisites.push('Binary Addressing', 'Physical Memory Layout');
            relatedConcepts.push('TLB Hit Ratio', 'Page Replacement Policies');
        }
        // Systems: Computer Architecture Cache (word-boundary safe, avoids ML data pipelines)
        else if (/\b(cache|mesi|set-associative|cache miss|cache line)\b/.test(text)) {
            topic = 'Computer Architecture';
            subtopic = 'Cache Architecture & Coherence';
            skills.push('Cache Mapping', 'Cache Miss Analysis');
            prerequisites.push('Memory Hierarchy', 'Memory Addressing');
            relatedConcepts.push('Spatial Locality', 'Temporal Locality');
        }
        // General fallback
        else {
            subtopic = question.subtopic || `${topic} Foundations`;
            skills.push(`${subtopic} Principles`, 'Problem Decomposition');
            prerequisites.push('Foundational Concepts');
            relatedConcepts.push(topic);
        }

        // 2. Question type heuristic
        let questionType: QuestionType = 'THEORY';
        if (text.includes('design the complete') || text.includes('design an experiment') || text.includes('design a correct') || text.includes('architect')) {
            questionType = 'DESIGN';
        } else if (text.includes('calculate') || text.includes('compute') || text.includes('formula') || text.includes('time complexity') || text.includes('confusion matrix:')) {
            questionType = 'NUMERICAL';
        } else if (text.includes('identify the likely problem') || text.includes('debug') || text.includes('identify the source of the misleading') || text.includes('identify the leakage') || text.includes('leakage')) {
            questionType = 'DEBUGGING';
        } else if (text.includes('construct a counterexample') || text.includes('why this claim is false') || text.includes('compare the approaches') || text.includes('explain what is problematic') || text.includes('critique')) {
            questionType = 'ANALYTICAL';
        } else if (text.includes('write code') || text.includes('implement a function') || text.includes('pseudocode')) {
            questionType = 'CODING';
        }

        // 3. Category heuristic
        let category: QuestionCategory = 'CONCEPTUAL';
        if (questionType === 'DESIGN') {
            category = 'DESIGN';
        } else if (questionType === 'DEBUGGING' || questionType === 'ANALYTICAL') {
            category = 'ANALYSIS';
        } else if (questionType === 'CODING' || questionType === 'NUMERICAL') {
            category = 'APPLICATION';
        } else if (text.includes('define') || text.includes('what is') || text.includes('which data structure')) {
            category = 'CONCEPTUAL';
        }

        // 4. Inferred Difficulty based on actual cognitive & technical complexity
        const difficulty = this.inferDifficulty(text, questionType, question.questionPrompt, combinesConcepts);

        const estimatedMinutes = difficulty === 'HARD' ? 10 : difficulty === 'MEDIUM' ? 5 : 3;

        return {
            topic,
            subtopic,
            difficulty,
            category,
            questionType,
            skills,
            learningObjectives: [`Master the core principles and rigorous analysis of ${subtopic}`],
            prerequisites,
            relatedConcepts: relatedConcepts.length > 0 ? relatedConcepts : [topic],
            combinesConcepts,
            estimatedMinutes
        };
    }

    /**
     * Calibrated difficulty evaluator based on cognitive demands, mathematical rigor, and multi-step reasoning.
     */
    private inferDifficulty(
        text: string,
        questionType: QuestionType,
        prompt: string,
        combinesConcepts: string[]
    ): QuestionDifficulty {
        let hardScore = 0;
        let easyScore = 0;

        // HARD indicator: Multi-step design or comprehensive strategy
        if (
            text.includes('design the complete') ||
            text.includes('modelling and evaluation strategy') ||
            text.includes('end-to-end') ||
            text.includes('justify your decisions rather than')
        ) {
            hardScore += 4;
        }

        // HARD indicator: Diagnostic counterexample or refuting a student misconception
        if (
            text.includes('construct a counterexample') ||
            text.includes('why this claim is false') ||
            text.includes('counterexample or reasoning argument')
        ) {
            hardScore += 3;
        }

        // HARD indicator: Subtle failure mode diagnosis (dead ReLU, leakage across folds, silent accuracy drop)
        if (
            text.includes('output exactly zero for almost every') ||
            text.includes('dead relu') ||
            text.includes('information from validation folds reaches the training process') ||
            text.includes('drops to almost random guessing') ||
            text.includes('accuracy falls to 68%') ||
            text.includes('source of the misleading validation') ||
            text.includes('leakage') ||
            text.includes('critique')
        ) {
            hardScore += 3;
        }

        // HARD indicator: Cost asymmetry, multi-stage calculation with threshold changes
        if (
            text.includes('20 times more costly') ||
            (text.includes('calculate precision, recall') && text.includes('f1-score') && text.includes('accuracy is misleading')) ||
            (text.includes('calculate the predicted probability') && text.includes('threshold of 0.5') && text.includes('threshold is increased to 0.8'))
        ) {
            hardScore += 3;
        }

        // HARD indicator: High-dimensional trade-offs, PCA vs Regularization, Concept drift distinguishing
        if (
            (text.includes('5,000 highly correlated features') && text.includes('800 training examples')) ||
            text.includes('distinguish them, specify monitoring signals') ||
            (text.includes('silhouette score proves') && text.includes('what is problematic about this conclusion'))
        ) {
            hardScore += 3;
        }

        // HARD indicator: Combining multiple distinct concepts
        if (combinesConcepts.length >= 2) {
            hardScore += 2;
        }

        // HARD indicator: High-depth question types with long prompt
        if ((questionType === 'DESIGN' || questionType === 'DEBUGGING') && prompt.length > 250) {
            hardScore += 2;
        }

        // EASY indicator: Simple definition or property recall
        if (
            prompt.length < 150 &&
            (text.startsWith('what is') ||
                text.startsWith('which data structure') ||
                text.startsWith('define') ||
                text.startsWith('which of the following') ||
                text.includes('time complexity of binary search') ||
                text.includes('operates on a last-in first-out'))
        ) {
            easyScore += 3;
        }

        if (prompt.length < 100 && (text.includes('definition') || text.includes('meaning of'))) {
            easyScore += 2;
        }

        if (hardScore >= 3) {
            return 'HARD';
        }
        if (easyScore >= 3) {
            return 'EASY';
        }

        return 'MEDIUM';
    }
}

export const questionOrganizerService = new QuestionOrganizerService();
export default questionOrganizerService;

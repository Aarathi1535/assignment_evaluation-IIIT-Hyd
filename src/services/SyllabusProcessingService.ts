import mongoose from 'mongoose';
import CourseSyllabus, { ICourseSyllabus } from '../models/CourseSyllabus';
import Course from '../models/Course';
import { HttpError } from '../lib/errors';
import {
    ExtractedSyllabusData,
    IAIQuestionGenerationProvider,
    GeminiAIQuestionGenerationProvider
} from './ai/AIQuestionGenerationProvider';

export class SyllabusProcessingService {
    private defaultProvider: IAIQuestionGenerationProvider;

    constructor(provider?: IAIQuestionGenerationProvider) {
        this.defaultProvider = provider || new GeminiAIQuestionGenerationProvider();
    }

    /**
     * Process raw syllabus text, extract units/topics, and save/update in DB.
     */
    async processSyllabus(
        courseId: string,
        rawText: string,
        userId: string,
        customProviderOrOptions?: IAIQuestionGenerationProvider | { userRole?: string; customProvider?: IAIQuestionGenerationProvider }
    ): Promise<ICourseSyllabus> {
        if (!courseId) {
            throw new HttpError('Course ID is required', 400);
        }
        if (!rawText || rawText.trim().length === 0) {
            throw new HttpError('Syllabus content cannot be empty', 400);
        }

        const course = await Course.findById(courseId);
        if (!course) {
            throw new HttpError('Course not found', 404);
        }

        // Determine options vs provider
        let provider: IAIQuestionGenerationProvider = this.defaultProvider;
        let actingRole: string | undefined;

        if (customProviderOrOptions) {
            if ('extractSyllabus' in customProviderOrOptions && typeof customProviderOrOptions.extractSyllabus === 'function') {
                provider = customProviderOrOptions;
            } else if (typeof customProviderOrOptions === 'object') {
                const opts = customProviderOrOptions as { userRole?: string; customProvider?: IAIQuestionGenerationProvider };
                actingRole = opts.userRole;
                if (opts.customProvider) {
                    provider = opts.customProvider;
                }
            }
        }

        // Enforce course ownership authorization if user is not admin
        const courseProfessorId = course.professor
            ? (typeof course.professor === 'object' && course.professor !== null && '_id' in (course.professor as object)
                ? (course.professor as { _id: unknown })._id?.toString()
                : String(course.professor))
            : '';

        if (actingRole && actingRole !== 'ADMIN' && courseProfessorId && courseProfessorId !== userId) {
            throw new HttpError('Forbidden: You are not authorized to manage the syllabus for this course', 403);
        }

        const extracted: ExtractedSyllabusData = await provider.extractSyllabus(
            rawText,
            course.courseCode || course.courseName || 'Course'
        );

        if (!extracted.units || extracted.units.length === 0) {
            throw new HttpError('Could not identify any syllabus units from the provided text', 400);
        }

        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
            throw new HttpError('Invalid or missing authenticated user identity', 401);
        }

        const uploaderObjectId = new mongoose.Types.ObjectId(userId);


        const syllabus = await CourseSyllabus.findOneAndUpdate(
            { course: course._id },
            {
                $set: {
                    course: course._id,
                    title: `${course.courseCode || course.courseName || 'Course'} Syllabus`,
                    rawText,
                    units: extracted.units,
                    extractedTopics: extracted.extractedTopics,
                    learningObjectives: extracted.learningObjectives || [],
                    uploadedBy: uploaderObjectId
                }
            },
            { upsert: true, returnDocument: 'after', new: true, runValidators: true }
        );

        if (!syllabus) {
            throw new HttpError('Failed to save syllabus to database', 500);
        }

        return syllabus;

    }

    /**
     * Retrieve stored syllabus for a course.
     */
    async getSyllabus(courseId: string): Promise<ICourseSyllabus | null> {
        if (!courseId) {
            throw new HttpError('Course ID is required', 400);
        }
        if (!mongoose.Types.ObjectId.isValid(courseId)) {
            throw new HttpError('Invalid course ID format', 400);
        }
        return CourseSyllabus.findOne({ course: courseId });
    }
}

const syllabusProcessingService = new SyllabusProcessingService();
export default syllabusProcessingService;


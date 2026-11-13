import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../lib/db';
import CourseSyllabus from '../../../../models/CourseSyllabus';
import PersonalizedQuestion, { IPersonalizedQuestion } from '../../../../models/PersonalizedQuestion';
import Course from '../../../../models/Course';
import { requireAuth, requireFeature } from '../../../../lib/apiAuth';
import { HttpError } from '../../../../lib/errors';

export interface TaxonomySubtopic {
    name: string;
    questionCount: number;
    difficultyCounts: {
        EASY: number;
        MEDIUM: number;
        HARD: number;
    };
    prerequisites: string[];
    relatedConcepts: string[];
}

export interface TaxonomyTopic {
    name: string;
    totalQuestions: number;
    subtopics: TaxonomySubtopic[];
}

export interface TaxonomySummaryData {
    topics: TaxonomyTopic[];
}

export async function GET(req: NextRequest) {
    const featureCheck = requireFeature('PERSONALIZED_ASSESSMENT');
    if (!featureCheck.authorized) {
        return (
            featureCheck.response ??
            NextResponse.json(
                { success: false, message: 'Personalized assessment feature is disabled', data: null },
                { status: 404 }
            )
        );
    }

    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    try {
        await connectDB();
        const url = new URL(req.url);
        const courseId = url.searchParams.get('courseId');

        if (!courseId) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'courseId query parameter is required',
                    error: { code: 'VALIDATION_FAILED', message: 'courseId query parameter is required' },
                    data: null
                },
                { status: 400 }
            );
        }

        if (!mongoose.Types.ObjectId.isValid(courseId)) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'Invalid courseId format',
                    error: { code: 'VALIDATION_FAILED', message: 'Invalid courseId format' },
                    data: null
                },
                { status: 400 }
            );
        }

        const courseOid = new mongoose.Types.ObjectId(courseId);
        const course = await Course.findById(courseOid);
        if (!course) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'Course not found',
                    error: { code: 'NOT_FOUND', message: 'Course not found' },
                    data: null
                },
                { status: 404 }
            );
        }

        // Fetch syllabus and active questions in parallel
        const [syllabus, questions] = await Promise.all([
            CourseSyllabus.findOne({ course: courseOid }),
            PersonalizedQuestion.find({ course: courseOid, isActive: true }).lean()
        ]);

        const assignedQuestionIds = new Set<string>();
        const topicList: TaxonomyTopic[] = [];

        if (syllabus && syllabus.units && syllabus.units.length > 0) {
            for (const unit of syllabus.units) {
                const subtopics: TaxonomySubtopic[] = [];
                let unitTotalQuestions = 0;

                for (const topicStr of unit.topics) {
                    const topicLower = topicStr.toLowerCase().trim();
                    const matchingQuestions = (questions as IPersonalizedQuestion[]).filter((q) => {
                        const qTopicLower = (q.topic || '').toLowerCase().trim();
                        const qSubtopicLower = (q.subtopic || '').toLowerCase().trim();
                        const qUnitLower = (q.unit || '').toLowerCase().trim();

                        const matches =
                            qTopicLower === topicLower ||
                            qSubtopicLower === topicLower ||
                            qTopicLower.includes(topicLower) ||
                            topicLower.includes(qTopicLower) ||
                            (qUnitLower.length > 0 && qUnitLower === unit.unitTitle.toLowerCase().trim() && (qTopicLower === topicLower || qSubtopicLower === topicLower));

                        if (matches) {
                            assignedQuestionIds.add(q._id.toString());
                        }
                        return matches;
                    });

                    const diffCounts = { EASY: 0, MEDIUM: 0, HARD: 0 };
                    const prereqsSet = new Set<string>();
                    const relatedSet = new Set<string>();

                    for (const mq of matchingQuestions) {
                        const diff = mq.difficulty as 'EASY' | 'MEDIUM' | 'HARD';
                        if (diff && diffCounts[diff] !== undefined) {
                            diffCounts[diff]++;
                        } else {
                            diffCounts.MEDIUM++;
                        }
                        if (Array.isArray(mq.prerequisites)) {
                            mq.prerequisites.forEach((p) => p && prereqsSet.add(p));
                        }
                        if (Array.isArray(mq.relatedConcepts)) {
                            mq.relatedConcepts.forEach((r) => r && relatedSet.add(r));
                        }
                    }

                    unitTotalQuestions += matchingQuestions.length;
                    subtopics.push({
                        name: topicStr,
                        questionCount: matchingQuestions.length,
                        difficultyCounts: diffCounts,
                        prerequisites: Array.from(prereqsSet),
                        relatedConcepts: Array.from(relatedSet)
                    });
                }

                // Check for questions tagged with this unit whose topic wasn't in unit.topics list
                const unitOtherQuestions = (questions as IPersonalizedQuestion[]).filter((q) => {
                    if (assignedQuestionIds.has(q._id.toString())) return false;
                    const qUnitLower = (q.unit || '').toLowerCase().trim();
                    return qUnitLower === unit.unitTitle.toLowerCase().trim();
                });

                if (unitOtherQuestions.length > 0) {
                    const extraSubtopicsMap = new Map<string, IPersonalizedQuestion[]>();
                    for (const eq of unitOtherQuestions) {
                        assignedQuestionIds.add(eq._id.toString());
                        const subName = eq.subtopic || eq.topic || 'General';
                        if (!extraSubtopicsMap.has(subName)) {
                            extraSubtopicsMap.set(subName, []);
                        }
                        extraSubtopicsMap.get(subName)!.push(eq);
                    }

                    for (const [subName, eqList] of extraSubtopicsMap.entries()) {
                        const diffCounts = { EASY: 0, MEDIUM: 0, HARD: 0 };
                        const prereqsSet = new Set<string>();
                        const relatedSet = new Set<string>();
                        for (const q of eqList) {
                            const diff = q.difficulty as 'EASY' | 'MEDIUM' | 'HARD';
                            if (diff && diffCounts[diff] !== undefined) diffCounts[diff]++;
                            else diffCounts.MEDIUM++;
                            if (Array.isArray(q.prerequisites)) q.prerequisites.forEach((p) => p && prereqsSet.add(p));
                            if (Array.isArray(q.relatedConcepts)) q.relatedConcepts.forEach((r) => r && relatedSet.add(r));
                        }
                        unitTotalQuestions += eqList.length;
                        subtopics.push({
                            name: subName,
                            questionCount: eqList.length,
                            difficultyCounts: diffCounts,
                            prerequisites: Array.from(prereqsSet),
                            relatedConcepts: Array.from(relatedSet)
                        });
                    }
                }

                topicList.push({
                    name: unit.unitTitle,
                    totalQuestions: unitTotalQuestions,
                    subtopics
                });
            }
        }

        // Remaining unassigned questions grouped by topic
        const unassignedQuestions = (questions as IPersonalizedQuestion[]).filter(
            (q) => !assignedQuestionIds.has(q._id.toString())
        );

        if (unassignedQuestions.length > 0) {
            const topicGroups = new Map<string, IPersonalizedQuestion[]>();
            for (const q of unassignedQuestions) {
                const topName = q.topic || 'General Concepts';
                if (!topicGroups.has(topName)) {
                    topicGroups.set(topName, []);
                }
                topicGroups.get(topName)!.push(q);
            }

            for (const [topName, qList] of topicGroups.entries()) {
                const subtopicsMap = new Map<string, IPersonalizedQuestion[]>();
                for (const q of qList) {
                    const subName = q.subtopic || q.topic || 'General';
                    if (!subtopicsMap.has(subName)) {
                        subtopicsMap.set(subName, []);
                    }
                    subtopicsMap.get(subName)!.push(q);
                }

                const subtopics: TaxonomySubtopic[] = [];
                for (const [subName, subList] of subtopicsMap.entries()) {
                    const diffCounts = { EASY: 0, MEDIUM: 0, HARD: 0 };
                    const prereqsSet = new Set<string>();
                    const relatedSet = new Set<string>();
                    for (const q of subList) {
                        const diff = q.difficulty as 'EASY' | 'MEDIUM' | 'HARD';
                        if (diff && diffCounts[diff] !== undefined) diffCounts[diff]++;
                        else diffCounts.MEDIUM++;
                        if (Array.isArray(q.prerequisites)) q.prerequisites.forEach((p) => p && prereqsSet.add(p));
                        if (Array.isArray(q.relatedConcepts)) q.relatedConcepts.forEach((r) => r && relatedSet.add(r));
                    }
                    subtopics.push({
                        name: subName,
                        questionCount: subList.length,
                        difficultyCounts: diffCounts,
                        prerequisites: Array.from(prereqsSet),
                        relatedConcepts: Array.from(relatedSet)
                    });
                }

                topicList.push({
                    name: topName,
                    totalQuestions: qList.length,
                    subtopics
                });
            }
        }

        const summary: TaxonomySummaryData = {
            topics: topicList
        };

        return NextResponse.json(
            {
                success: true,
                message: 'Course taxonomy retrieved successfully',
                data: summary
            },
            { status: 200 }
        );
    } catch (error: unknown) {
        console.error('[GET /api/personalized/taxonomy]', error);
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        const status = error instanceof HttpError ? error.statusCode : 500;
        return NextResponse.json(
            {
                success: false,
                message,
                error: { code: 'INTERNAL_ERROR', message },
                data: null
            },
            { status }
        );
    }
}

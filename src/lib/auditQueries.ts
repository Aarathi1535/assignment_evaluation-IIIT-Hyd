import mongoose from 'mongoose';

export function buildExamAuditLogFilter(examId: string) {
    const objectId = new mongoose.Types.ObjectId(examId);
    return {
        $or: [
            { entityId: objectId },
            { 'details.examId': examId },
            { 'details.examId': objectId },
            { 'details.exam': examId },
            { 'details.exam': objectId }
        ]
    };
}

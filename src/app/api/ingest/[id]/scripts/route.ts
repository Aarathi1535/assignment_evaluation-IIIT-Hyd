import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../lib/db';
import { requirePermission } from '../../../../../lib/apiAuth';
import { Permission } from '../../../../../constants/permissions';
import BatchRepository from '../../../../../repositories/BatchRepository';
import AnswerScript from '../../../../../models/AnswerScript';
import IngestionPage from '../../../../../models/IngestionPage';
import StudentMapping from '../../../../../models/StudentMapping';
import { IUser } from '../../../../../models/User';

interface PopulatedStudentMapping {
  anonymousId: string;
  student: IUser;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(Permission.EDIT_EXAM);
  if (!auth.authorized) {
    return auth.response;
  }

  const { id } = await context.params;
  const batchId = id;

  if (!batchId) {
    return NextResponse.json({
      success: false,
      message: 'Invalid batchId',
      data: null
    }, { status: 400 });
  }

  try {
    await connectDB();

    // Verify authorized access to the batch
    const batch = await BatchRepository.getBatchById(batchId, auth.user.id, auth.user.role);
    if (!batch) {
      return NextResponse.json({
        success: false,
        message: 'Batch not found or access denied',
        data: null
      }, { status: 404 });
    }

    // Fetch AnswerScripts for this batch, sorted deterministically
    const scripts = await AnswerScript.find({ batchId, isActive: true }).sort({ fileIndex: 1, startPageNumber: 1 });

    // Fetch IngestionPages for this batch, sorted deterministically
    const pages = await IngestionPage.find({ batchId }).sort({ fileIndex: 1, pageNumber: 1 });

    // Fetch StudentMappings to resolve anonymous IDs to student users
    const mappings = batch.exam
      ? (await StudentMapping.find({ exam: batch.exam }).populate('student')) as unknown as PopulatedStudentMapping[]
      : [];
    const mappingMap = new Map<string, IUser>();
    for (const m of mappings) {
      if (m.anonymousId && m.student) {
        mappingMap.set(m.anonymousId, m.student);
      }
    }

    // Construct response mapping
    const formattedScripts = scripts.map(script => {
      const scriptPages = pages
        .filter(p => p.answerScript && p.answerScript.toString() === script._id.toString())
        .map(p => ({
          _id: p._id,
          pageNumber: p.pageNumber,
          fileIndex: p.fileIndex,
          thumbnailUrl: `/api/ingest/${batchId}/pages/${p._id}/thumbnail`,
          width: p.width,
          height: p.height,
          nearBlank: p.nearBlank,
          isDuplicate: p.isDuplicate,
          duplicateOf: p.duplicateOf ? p.duplicateOf.toString() : null,
          omrResult: p.metadata?.omrResult || null
        }));

      const omrAnonId = script.omrStudentId;
      const omrResolvedStudent = omrAnonId ? mappingMap.get(omrAnonId) : null;
      const omrResolvedStudentFormatted = omrResolvedStudent ? {
        _id: omrResolvedStudent._id.toString(),
        name: omrResolvedStudent.name,
        email: omrResolvedStudent.email,
        role: omrResolvedStudent.role
      } : null;

      const qrAnonId = script.qrStudentId;
      const qrResolvedStudent = qrAnonId ? mappingMap.get(qrAnonId) : null;
      const qrResolvedStudentFormatted = qrResolvedStudent ? {
        _id: qrResolvedStudent._id.toString(),
        name: qrResolvedStudent.name,
        email: qrResolvedStudent.email,
        role: qrResolvedStudent.role
      } : null;

      return {
        _id: script._id,
        __v: script.__v,
        exam: script.exam,
        student: script.student,
        candidateStudentId: script.candidateStudentId,
        identificationSource: script.identificationSource,
        identificationStatus: script.identificationStatus,
        needsManualId: script.needsManualId,
        manualIdReason: script.manualIdReason,
        fileIndex: script.fileIndex,
        startPageNumber: script.startPageNumber,
        endPageNumber: script.endPageNumber,
        pageCount: script.pageCount,
        qrStudentId: script.qrStudentId || null,
        qrDecodeOutcome: script.qrDecodeOutcome || null,
        omrStudentId: script.omrStudentId || null,
        omrDecodeOutcome: script.omrDecodeOutcome || null,
        hasIdentificationConflict: script.hasIdentificationConflict || false,
        omrResolvedStudent: omrResolvedStudentFormatted,
        qrResolvedStudent: qrResolvedStudentFormatted,
        pages: scriptPages
      };
    });

    return NextResponse.json({
      success: true,
      message: 'AnswerScripts retrieved successfully',
      data: formattedScripts
    }, { status: 200 });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    return NextResponse.json({
      success: false,
      message,
      data: null
    }, { status: 500 });
  }
}

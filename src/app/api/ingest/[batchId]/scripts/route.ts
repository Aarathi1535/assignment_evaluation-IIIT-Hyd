import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../lib/db';
import { requirePermission } from '../../../../../lib/apiAuth';
import { Permission } from '../../../../../constants/permissions';
import BatchRepository from '../../../../../repositories/BatchRepository';
import AnswerScript from '../../../../../models/AnswerScript';
import IngestionPage from '../../../../../models/IngestionPage';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ batchId: string }> }
) {
  const auth = await requirePermission(Permission.EDIT_EXAM);
  if (!auth.authorized) {
    return auth.response;
  }

  const { batchId } = await context.params;

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
          height: p.height
        }));

      return {
        _id: script._id,
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

import fs from 'fs';
import { describe, it, expect, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import { PageIngestionService } from '../services/PageIngestionService';
import {
    IPageRenderer,
    DefaultPdfRenderer,
    RenderPageInput,
    RenderPageResult,
    DEFAULT_PAGE_RENDERING_CONFIG,
    calculateSafeRenderDimensions
} from '../services/PageRenderer';
import defaultDerivedStorageService, { IDerivedStorageService } from '../services/DerivedStorageService';

function createCustomPdfBuffer(widthPt = 612, heightPt = 792, pageCount = 1): Buffer {
    let pdfStr = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [`;
    for (let i = 1; i <= pageCount; i++) {
        pdfStr += `${i + 2} 0 R `;
    }
    pdfStr += `] /Count ${pageCount} >>\nendobj\n`;

    for (let i = 1; i <= pageCount; i++) {
        pdfStr += `${i + 2} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] >>\nendobj\n`;
    }
    pdfStr += `xref\n0 ${pageCount + 3}\ntrailer\n<< /Size ${pageCount + 3} /Root 1 0 R >>\nstartxref\n500\n%%EOF`;
    return Buffer.from(pdfStr, 'utf-8');
}

describe('PageIngestionService & Real DefaultPdfRenderer (AE-046)', () => {
    const batchId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    const jobId = new mongoose.Types.ObjectId();
    const storageKey = `batches/${batchId}/${fileId}.pdf`;

    afterEach(async () => {
        vi.restoreAllMocks();
    });

    describe('1. Real PDF Rendering via DefaultPdfRenderer (pdfjs-dist)', () => {
        it('should render page 1 of a real minimal PDF to a valid PNG raster buffer', async () => {
            const renderer = new DefaultPdfRenderer();
            const pdfBuffer = createCustomPdfBuffer(612, 792, 1);

            const input: RenderPageInput = {
                batchId: 'batch-real-1',
                fileId: 'file-real-1',
                pageNumber: 1,
                fileType: 'pdf',
                fileBuffer: pdfBuffer
            };

            const result: RenderPageResult = await renderer.renderPage(input);

            expect(result.success).toBe(true);
            expect(result.pageNumber).toBe(1);
            expect(result.image).toBeDefined();
            expect(result.image!.format).toBe('png');
            expect(result.image!.dpi).toBe(150);
            expect(result.image!.width).toBeGreaterThan(0);
            expect(result.image!.height).toBeGreaterThan(0);
            expect(result.image!.sizeBytes).toBeGreaterThan(0);

            // Verify PNG magic bytes (0x89, 0x50, 0x4E, 0x47)
            const imgBuf = result.image!.buffer;
            expect(imgBuf[0]).toBe(0x89);
            expect(imgBuf[1]).toBe(0x50);
            expect(imgBuf[2]).toBe(0x4e);
            expect(imgBuf[3]).toBe(0x47);

            // Metadata check
            expect(result.metadata).toBeDefined();
            expect(result.metadata!.totalPages).toBe(1);
            expect(result.metadata!.format).toBe('png');
        });

        it('should render individual pages of a multi-page PDF document', async () => {
            const renderer = new DefaultPdfRenderer();
            const multiPagePdf = createCustomPdfBuffer(612, 792, 3);

            // Authoritative page count discovery
            const pageCount = await renderer.getPageCount(multiPagePdf);
            expect(pageCount).toBe(3);

            // Render page 1
            const result1 = await renderer.renderPage({
                batchId: 'batch-multi',
                fileId: 'file-multi',
                pageNumber: 1,
                fileType: 'pdf',
                fileBuffer: multiPagePdf
            });
            expect(result1.success).toBe(true);
            expect(result1.pageNumber).toBe(1);
            expect(result1.image).toBeDefined();

            // Render page 2
            const result2 = await renderer.renderPage({
                batchId: 'batch-multi',
                fileId: 'file-multi',
                pageNumber: 2,
                fileType: 'pdf',
                fileBuffer: multiPagePdf
            });
            expect(result2.success).toBe(true);
            expect(result2.pageNumber).toBe(2);
            expect(result2.image).toBeDefined();

            // Render page 3
            const result3 = await renderer.renderPage({
                batchId: 'batch-multi',
                fileId: 'file-multi',
                pageNumber: 3,
                fileType: 'pdf',
                fileBuffer: multiPagePdf
            });
            expect(result3.success).toBe(true);
            expect(result3.pageNumber).toBe(3);
            expect(result3.image).toBeDefined();
        });

        it('should produce a clean failure when given an invalid or corrupt PDF buffer', async () => {
            const renderer = new DefaultPdfRenderer();
            const corruptBuffer = Buffer.from('NOT_A_VALID_PDF_STREAM_CORRUPT_DATA');

            const result = await renderer.renderPage({
                batchId: 'batch-corrupt',
                fileId: 'file-corrupt',
                pageNumber: 1,
                fileType: 'pdf',
                fileBuffer: corruptBuffer
            });

            expect(result.success).toBe(false);
            expect(result.failureReason).toBeDefined();
            expect(result.failureReason).not.toContain('at ');
        });

        it('should produce a clean failure when page number is out of bounds', async () => {
            const renderer = new DefaultPdfRenderer();
            const singlePagePdf = createCustomPdfBuffer(612, 792, 1);

            // Page 0 (out of bounds)
            const result0 = await renderer.renderPage({
                batchId: 'batch-bounds',
                fileId: 'file-bounds',
                pageNumber: 0,
                fileType: 'pdf',
                fileBuffer: singlePagePdf
            });
            expect(result0.success).toBe(false);
            expect(result0.failureReason).toContain('out of bounds');

            // Page 5 (out of bounds for 1-page document)
            const result5 = await renderer.renderPage({
                batchId: 'batch-bounds',
                fileId: 'file-bounds',
                pageNumber: 5,
                fileType: 'pdf',
                fileBuffer: singlePagePdf
            });
            expect(result5.success).toBe(false);
            expect(result5.failureReason).toContain('out of bounds');
        });

        it('should produce a clean failure when fileBuffer is missing or empty', async () => {
            const renderer = new DefaultPdfRenderer();

            const result = await renderer.renderPage({
                batchId: 'batch-empty',
                fileId: 'file-empty',
                pageNumber: 1,
                fileType: 'pdf'
            });

            expect(result.success).toBe(false);
            expect(result.failureReason).toContain('missing or empty');
        });
    });

    describe('2. Rendering Safety Limits & Bounded Dimensions', () => {
        it('should render normal standard letter page at target DPI without reduction', () => {
            const dims = calculateSafeRenderDimensions(612, 792, DEFAULT_PAGE_RENDERING_CONFIG);
            expect(dims.width).toBe(1275);
            expect(dims.height).toBe(1650);
            expect(dims.effectiveDpi).toBe(150);
            expect(Math.max(dims.width, dims.height)).toBeLessThanOrEqual(DEFAULT_PAGE_RENDERING_CONFIG.maxLongEdge);
            expect(dims.width * dims.height).toBeLessThanOrEqual(DEFAULT_PAGE_RENDERING_CONFIG.maxPixels);
        });

        it('should proportionally reduce scale when a page long edge exceeds maxLongEdge (2048px)', () => {
            const dims = calculateSafeRenderDimensions(1500, 3000, DEFAULT_PAGE_RENDERING_CONFIG);

            expect(dims.height).toBe(2048);
            expect(dims.width).toBe(1024);
            expect(Math.max(dims.width, dims.height)).toBeLessThanOrEqual(2048);
            expect(dims.width * dims.height).toBeLessThanOrEqual(16777216);

            // Aspect ratio preserved
            expect(dims.width / dims.height).toBeCloseTo(1500 / 3000, 2);
        });

        it('should proportionally reduce scale when total pixels exceed maxPixels limit', () => {
            const customConfig = {
                targetDpi: 150,
                maxLongEdge: 5000,
                maxPixels: 4000000,
                outputFormat: 'png' as const
            };

            const dims = calculateSafeRenderDimensions(2000, 2000, customConfig);
            expect(dims.width * dims.height).toBeLessThanOrEqual(4000000);
            expect(dims.width).toBe(2000);
            expect(dims.height).toBe(2000);
            expect(dims.width / dims.height).toBe(1);
        });

        it('should never upscale page beyond requested targetDpi / 72 merely to reach limits', () => {
            const dims = calculateSafeRenderDimensions(72, 72, DEFAULT_PAGE_RENDERING_CONFIG);
            expect(dims.width).toBe(150);
            expect(dims.height).toBe(150);
            expect(dims.effectiveDpi).toBe(150);
        });

        it('should render large PDF page through DefaultPdfRenderer with safety bounds enforced', async () => {
            const renderer = new DefaultPdfRenderer();
            const largePdf = createCustomPdfBuffer(2000, 3000, 1);

            const result = await renderer.renderPage({
                batchId: 'batch-large',
                fileId: 'file-large',
                pageNumber: 1,
                fileType: 'pdf',
                fileBuffer: largePdf
            });

            expect(result.success).toBe(true);
            expect(result.image).toBeDefined();
            expect(result.image!.height).toBeLessThanOrEqual(2048);
            expect(result.image!.width).toBeLessThanOrEqual(2048);
            expect(result.image!.width * result.image!.height).toBeLessThanOrEqual(16777216);

            const ratio = result.image!.width / result.image!.height;
            expect(ratio).toBeCloseTo(2000 / 3000, 1);
        });
    });

    describe('3. Deterministic Derived-Asset Storage (AE-046 Step 4)', () => {
        it('should store normalized page image under deterministic derived key format', async () => {
            const service = new PageIngestionService();
            const pdfBuffer = createCustomPdfBuffer(612, 792, 1);

            const result = await service.processPage({
                batchId,
                jobId,
                fileId,
                fileIndex: 0,
                storageKey,
                pageNumber: 1,
                fileType: 'pdf',
                fileBuffer: pdfBuffer
            });

            expect(result.success).toBe(true);
            expect(result.pageRecord).toBeDefined();

            // Storage key on IngestionPage points to derived asset, NOT original PDF
            const expectedDerivedKey = `batches/${batchId}/derived/${fileId}/1/page.png`;
            expect(result.pageRecord!.storageKey).toBe(expectedDerivedKey);

            // Metadata records both original and derived keys
            const metadata = result.pageRecord!.metadata as Record<string, unknown>;
            expect(metadata.originalStorageKey).toBe(storageKey);
            expect(metadata.derivedStorageKey).toBe(expectedDerivedKey);
            expect(metadata.format).toBe('png');

            // Verify stored asset exists on disk and is a valid PNG
            const diskPath = defaultDerivedStorageService.getDerivedDiskPath(expectedDerivedKey);
            expect(fs.existsSync(diskPath)).toBe(true);

            const diskBuffer = await fs.promises.readFile(diskPath);
            expect(diskBuffer[0]).toBe(0x89);
            expect(diskBuffer[1]).toBe(0x50);
            expect(diskBuffer[2]).toBe(0x4e);
            expect(diskBuffer[3]).toBe(0x47);
        });

        it('should idempotently reuse existing page record and derived asset on retry', async () => {
            const service = new PageIngestionService();
            const pdfBuffer = createCustomPdfBuffer(612, 792, 1);

            // First run
            const result1 = await service.processPage({
                batchId,
                jobId,
                fileId,
                fileIndex: 0,
                storageKey,
                pageNumber: 1,
                fileType: 'pdf',
                fileBuffer: pdfBuffer
            });
            expect(result1.success).toBe(true);

            // Second run (retry)
            const result2 = await service.processPage({
                batchId,
                jobId,
                fileId,
                fileIndex: 0,
                storageKey,
                pageNumber: 1,
                fileType: 'pdf',
                fileBuffer: pdfBuffer
            });

            expect(result2.success).toBe(true);
            expect(result2.isDuplicateOrAlreadyProcessed).toBe(true);

            // Check database: exactly 1 IngestionPage document exists
            const pages = await IngestionPage.find({ batchId, fileIndex: 0, pageNumber: 1 });
            expect(pages.length).toBe(1);
            expect(pages[0].storageKey).toBe(`batches/${batchId}/derived/${fileId}/1/page.png`);
        });

        it('should allow custom or mock derived storage service injection', async () => {
            const mockStorage: IDerivedStorageService = {
                storeDerivedPage: vi.fn().mockResolvedValue({
                    storageKey: `batches/${batchId}/derived/${fileId}/1/page.png`,
                    storagePath: '/mock/path/page.png',
                    size: 1024
                }),
                getDerivedPageKey: vi.fn().mockReturnValue(`batches/${batchId}/derived/${fileId}/1/page.png`),
                storeDerivedThumbnail: vi.fn().mockResolvedValue({
                    storageKey: `batches/${batchId}/derived/${fileId}/1/thumb.jpg`,
                    storagePath: '/mock/path/thumb.jpg',
                    size: 512
                }),
                getDerivedThumbnailKey: vi.fn().mockReturnValue(`batches/${batchId}/derived/${fileId}/1/thumb.jpg`)
            };

            const service = new PageIngestionService(undefined, mockStorage);
            const pdfBuffer = createCustomPdfBuffer(612, 792, 1);

            const result = await service.processPage({
                batchId,
                jobId,
                fileId,
                fileIndex: 0,
                storageKey,
                pageNumber: 1,
                fileType: 'pdf',
                fileBuffer: pdfBuffer
            });

            expect(result.success).toBe(true);
            expect(mockStorage.storeDerivedPage).toHaveBeenCalledTimes(1);
            expect(mockStorage.storeDerivedPage).toHaveBeenCalledWith(
                expect.objectContaining({
                    batchId,
                    fileId,
                    pageNumber: 1,
                    format: 'png'
                })
            );
        });

        it('should not create a successful storage reference when rendering fails', async () => {
            const corruptBuffer = Buffer.from('CORRUPT_BYTES');
            const service = new PageIngestionService();

            const result = await service.processPage({
                batchId,
                jobId,
                fileId,
                fileIndex: 0,
                storageKey,
                pageNumber: 1,
                fileType: 'pdf',
                fileBuffer: corruptBuffer
            });

            expect(result.success).toBe(false);

            const pageInDb = await IngestionPage.findOne({ batchId, fileIndex: 0, pageNumber: 1 });
            expect(pageInDb).not.toBeNull();
            expect(pageInDb!.status).toBe(PageProcessingStatus.FAILED);
            // On failure, storageKey retains the original input reference rather than a fake derived asset
            expect(pageInDb!.storageKey).toBe(storageKey);
        });
    });

    describe('4. Renderer Dependency Injection & Mocking Support', () => {
        it('should allow injecting a custom fake renderer via constructor', async () => {
            const customRenderer: IPageRenderer = {
                renderPage: vi.fn().mockResolvedValue({
                    success: true,
                    pageNumber: 1,
                    image: {
                        buffer: Buffer.from('FAKE_PNG'),
                        format: 'png',
                        width: 800,
                        height: 600,
                        dpi: 150,
                        pageNumber: 1,
                        sizeBytes: 8
                    },
                    metadata: { custom: true }
                })
            };

            const service = new PageIngestionService(customRenderer);
            expect(service.getRenderer()).toBe(customRenderer);

            const result = await service.processPage({
                batchId,
                jobId,
                fileId,
                fileIndex: 0,
                storageKey,
                pageNumber: 1,
                fileType: 'pdf'
            });

            expect(result.success).toBe(true);
            expect(customRenderer.renderPage).toHaveBeenCalledWith(
                expect.objectContaining({
                    batchId,
                    fileId,
                    pageNumber: 1,
                    fileType: 'pdf',
                    storageKey
                })
            );
        });

        it('should allow dynamically setting renderer via setRenderer', async () => {
            const service = new PageIngestionService();
            const customRenderer: IPageRenderer = {
                renderPage: vi.fn().mockResolvedValue({
                    success: true,
                    pageNumber: 2,
                    image: {
                        buffer: Buffer.from('FAKE_PNG'),
                        format: 'png',
                        width: 800,
                        height: 600,
                        dpi: 150,
                        pageNumber: 2,
                        sizeBytes: 8
                    }
                })
            };

            service.setRenderer(customRenderer);
            expect(service.getRenderer()).toBe(customRenderer);

            const result = await service.processPage({
                batchId,
                jobId,
                fileId,
                fileIndex: 0,
                storageKey,
                pageNumber: 2,
                fileType: 'pdf'
            });

            expect(result.success).toBe(true);
            expect(customRenderer.renderPage).toHaveBeenCalledTimes(1);
        });

        it('should allow per-call renderer override in processPage input', async () => {
            const defaultRenderer: IPageRenderer = {
                renderPage: vi.fn().mockResolvedValue({ success: true, pageNumber: 1 })
            };
            const overrideRenderer: IPageRenderer = {
                renderPage: vi.fn().mockResolvedValue({
                    success: true,
                    pageNumber: 1,
                    image: {
                        buffer: Buffer.from('FAKE_PNG'),
                        format: 'png',
                        width: 800,
                        height: 600,
                        dpi: 150,
                        pageNumber: 1,
                        sizeBytes: 8
                    }
                })
            };

            const service = new PageIngestionService(defaultRenderer);

            await service.processPage({
                batchId,
                jobId,
                fileId,
                fileIndex: 0,
                storageKey,
                pageNumber: 1,
                fileType: 'pdf',
                renderer: overrideRenderer
            });

            expect(defaultRenderer.renderPage).not.toHaveBeenCalled();
            expect(overrideRenderer.renderPage).toHaveBeenCalledTimes(1);
        });
    });

    describe('5. Error Sanitization & Handling on Injected Failures', () => {
        it('should sanitize renderer exception stack traces without fabricated paths', async () => {
            const failingRenderer: IPageRenderer = {
                renderPage: vi.fn().mockRejectedValue(
                    new Error('Failed to parse PDF stream on page 3\n at PdfjsParser.decode (/internal/pdfjs/parser.ts:112)\n at async Engine.render')
                )
            };

            const service = new PageIngestionService(failingRenderer);

            const result = await service.processPage({
                batchId,
                jobId,
                fileId,
                fileIndex: 0,
                storageKey,
                pageNumber: 3,
                fileType: 'pdf'
            });

            expect(result.success).toBe(false);
            expect(result.failureReason).toBe('Failed to parse PDF stream on page 3');
            expect(result.failureReason).not.toContain('at PdfjsParser');
            expect(result.failureReason).not.toContain('/internal/pdfjs');

            const pageInDb = await IngestionPage.findOne({ batchId, fileIndex: 0, pageNumber: 3 });
            expect(pageInDb).not.toBeNull();
            expect(pageInDb!.status).toBe(PageProcessingStatus.FAILED);
            expect(pageInDb!.failureReason).toBe('Failed to parse PDF stream on page 3');
        });

        it('should handle renderer returning explicit failure result with sanitized reason', async () => {
            const failingRenderer: IPageRenderer = {
                renderPage: vi.fn().mockResolvedValue({
                    success: false,
                    pageNumber: 4,
                    failureReason: 'Invalid font descriptor on page 4\n at FontTable.load (/fonts/table.js:55)'
                })
            };

            const service = new PageIngestionService(failingRenderer);

            const result = await service.processPage({
                batchId,
                jobId,
                fileId,
                fileIndex: 0,
                storageKey,
                pageNumber: 4,
                fileType: 'pdf'
            });

            expect(result.success).toBe(false);
            expect(result.failureReason).toBe('Invalid font descriptor on page 4');
            expect(result.failureReason).not.toContain('at FontTable');

            const pageInDb = await IngestionPage.findOne({ batchId, fileIndex: 0, pageNumber: 4 });
            expect(pageInDb!.status).toBe(PageProcessingStatus.FAILED);
            expect(pageInDb!.failureReason).toBe('Invalid font descriptor on page 4');
        });
    });

    describe('6. Timeout Protection', () => {
        it('should enforce timeout on slow or hung renderer execution', async () => {
            const hungRenderer: IPageRenderer = {
                renderPage: vi.fn().mockImplementation(
                    () => new Promise((resolve) => setTimeout(resolve, 5000))
                )
            };

            const service = new PageIngestionService(hungRenderer);

            const result = await service.processPage({
                batchId,
                jobId,
                fileId,
                fileIndex: 0,
                storageKey,
                pageNumber: 5,
                fileType: 'pdf',
                timeoutMs: 50
            });

            expect(result.success).toBe(false);
            expect(result.failureReason).toContain('Page 5 processing timed out after 50ms');

            const pageInDb = await IngestionPage.findOne({ batchId, fileIndex: 0, pageNumber: 5 });
            expect(pageInDb!.status).toBe(PageProcessingStatus.FAILED);
            expect(pageInDb!.failureReason).toContain('timed out after 50ms');
        });
    });

    describe('7. Idempotency Preservation', () => {
        it('should not re-render or overwrite already processed pages', async () => {
            // Pre-create already processed page
            await IngestionPage.create({
                batchId,
                job: jobId,
                fileId,
                fileIndex: 0,
                storageKey: `batches/${batchId}/derived/${fileId}/1/page.png`,
                pageNumber: 1,
                status: PageProcessingStatus.PROCESSED,
                processedAt: new Date()
            });

            const renderer: IPageRenderer = {
                renderPage: vi.fn().mockResolvedValue({ success: true, pageNumber: 1 })
            };

            const service = new PageIngestionService(renderer);

            const result = await service.processPage({
                batchId,
                jobId,
                fileId,
                fileIndex: 0,
                storageKey,
                pageNumber: 1,
                fileType: 'pdf'
            });

            expect(result.success).toBe(true);
            expect(result.isDuplicateOrAlreadyProcessed).toBe(true);
            expect(renderer.renderPage).not.toHaveBeenCalled();

            const pagesInDb = await IngestionPage.find({ batchId, fileIndex: 0, pageNumber: 1 });
            expect(pagesInDb.length).toBe(1);
        });
    });

    describe('8. Thumbnail Generation & Failure Independence (AE-047)', () => {
        it('should generate and persist thumbnailKey, width, and height on successful page processing', async () => {
            const pdfBuffer = createCustomPdfBuffer(612, 792, 1);
            const service = new PageIngestionService();

            const testBatchId = crypto.randomUUID();
            const testFileId = crypto.randomUUID();

            const result = await service.processPage({
                batchId: testBatchId,
                jobId,
                fileId: testFileId,
                fileIndex: 0,
                storageKey: `batches/${testBatchId}/${testFileId}.pdf`,
                pageNumber: 1,
                fileType: 'pdf',
                fileBuffer: pdfBuffer
            });

            expect(result.success).toBe(true);
            expect(result.pageRecord).toBeDefined();
            expect(result.pageRecord!.thumbnailKey).toBe(`batches/${testBatchId}/derived/${testFileId}/1/thumb.jpg`);
            expect(result.pageRecord!.width).toBe(1275);
            expect(result.pageRecord!.height).toBe(1650);

            // Verify thumbnail exists in DB
            const pageInDb = await IngestionPage.findOne({ batchId: testBatchId, fileIndex: 0, pageNumber: 1 });
            expect(pageInDb!.thumbnailKey).toBe(`batches/${testBatchId}/derived/${testFileId}/1/thumb.jpg`);
            expect(pageInDb!.width).toBe(1275);
            expect(pageInDb!.height).toBe(1650);
            expect(pageInDb!.status).toBe(PageProcessingStatus.PROCESSED);
        });

        it('should expose thumbnailKey as null when thumbnail generation fails, leaving page PROCESSED', async () => {
            const pdfBuffer = createCustomPdfBuffer(612, 792, 1);
            const service = new PageIngestionService();

            // Mock thumbnail generator to fail
            const failingThumbGen = {
                generateThumbnail: vi.fn().mockRejectedValue(new Error('Out of memory in thumbnail worker'))
            };
            service.setThumbnailGenerator(failingThumbGen);

            const testBatchId = crypto.randomUUID();
            const testFileId = crypto.randomUUID();

            const result = await service.processPage({
                batchId: testBatchId,
                jobId,
                fileId: testFileId,
                fileIndex: 0,
                storageKey: `batches/${testBatchId}/${testFileId}.pdf`,
                pageNumber: 1,
                fileType: 'pdf',
                fileBuffer: pdfBuffer
            });

            // Page must remain PROCESSED
            expect(result.success).toBe(true);
            expect(result.pageRecord!.status).toBe(PageProcessingStatus.PROCESSED);
            expect(result.pageRecord!.thumbnailKey).toBeNull();
            expect(result.pageRecord!.storageKey).toBe(`batches/${testBatchId}/derived/${testFileId}/1/page.png`);

            const pageInDb = await IngestionPage.findOne({ batchId: testBatchId, fileIndex: 0, pageNumber: 1 });
            expect(pageInDb!.status).toBe(PageProcessingStatus.PROCESSED);
            expect(pageInDb!.thumbnailKey).toBeNull();
        });

        it('should reconcile missing thumbnail on retry of an already PROCESSED page', async () => {
            const testBatchId = crypto.randomUUID();
            const testFileId = crypto.randomUUID();
            const pdfBuffer = createCustomPdfBuffer(612, 792, 1);

            const service = new PageIngestionService();

            // 1. Process with failing thumbnail generator
            const failingThumbGen = {
                generateThumbnail: vi.fn().mockRejectedValue(new Error('Temporary thumbnail failure'))
            };
            service.setThumbnailGenerator(failingThumbGen);

            const initialResult = await service.processPage({
                batchId: testBatchId,
                jobId,
                fileId: testFileId,
                fileIndex: 0,
                storageKey: `batches/${testBatchId}/${testFileId}.pdf`,
                pageNumber: 1,
                fileType: 'pdf',
                fileBuffer: pdfBuffer
            });

            expect(initialResult.success).toBe(true);
            expect(initialResult.pageRecord!.thumbnailKey).toBeNull();

            // 2. Retry with default (working) thumbnail generator
            service.setThumbnailGenerator(new (await import('../services/ThumbnailGenerator')).DefaultThumbnailGenerator());

            const retryResult = await service.processPage({
                batchId: testBatchId,
                jobId,
                fileId: testFileId,
                fileIndex: 0,
                storageKey: `batches/${testBatchId}/${testFileId}.pdf`,
                pageNumber: 1,
                fileType: 'pdf'
            });

            expect(retryResult.success).toBe(true);
            expect(retryResult.isDuplicateOrAlreadyProcessed).toBe(true);

            // Thumbnail must now be reconciled in DB!
            const reconciledPage = await IngestionPage.findOne({ batchId: testBatchId, fileIndex: 0, pageNumber: 1 });
            expect(reconciledPage!.status).toBe(PageProcessingStatus.PROCESSED);
            expect(reconciledPage!.thumbnailKey).toBe(`batches/${testBatchId}/derived/${testFileId}/1/thumb.jpg`);
        });

        it('should report thumbnailKey as null for existing legacy Page documents without thumbnail', async () => {
            const testBatchId = crypto.randomUUID();
            const testFileId = crypto.randomUUID();

            const legacyPage = await IngestionPage.create({
                batchId: testBatchId,
                job: jobId,
                fileId: testFileId,
                fileIndex: 0,
                storageKey: `batches/${testBatchId}/derived/${testFileId}/1/page.png`,
                pageNumber: 1,
                status: PageProcessingStatus.PROCESSED,
                processedAt: new Date()
            });

            expect(legacyPage.thumbnailKey).toBeNull();
        });
    });
});


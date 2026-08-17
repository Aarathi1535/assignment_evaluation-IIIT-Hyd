/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll } from 'vitest';
import { countPdfPages, validateFiles } from '../utils/clientFileValidation';

// Mock FileReader since we are running in a Node environment for Vitest
class MockFileReader {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  result: string = '';

  readAsBinaryString(file: any) {
    if (file._shouldFail) {
      if (this.onerror) {
        this.onerror();
      }
    } else {
      this.result = file._content || '';
      if (this.onload) {
        this.onload();
      }
    }
  }
}

beforeAll(() => {
  global.FileReader = MockFileReader as any;
});

describe('Upload UI Client-side Validation and PDF Helpers (AE-058)', () => {
  it('countPdfPages - should count page count correctly for a valid PDF structure with /Count', async () => {
    const validPdfContent = '%PDF-1.4\n/Type /Pages /Count 5\n/Type /Page\n/Type /Page\n%%EOF';
    const mockFile = {
      name: 'test.pdf',
      _content: validPdfContent
    } as any;

    const count = await countPdfPages(mockFile);
    expect(count).toBe(5);
  });

  it('countPdfPages - should reject invalid files missing %PDF header', async () => {
    const invalidPdfContent = 'some random text without PDF header';
    const mockFile = {
      name: 'test.txt',
      _content: invalidPdfContent
    } as any;

    await expect(countPdfPages(mockFile)).rejects.toThrow('Invalid or corrupted PDF file');
  });

  it('countPdfPages - should fallback to counting distinct /Type /Page objects if /Count is missing', async () => {
    const noCountPdfContent = '%PDF-1.4\n/Type /Page\n/Type /Page\n/Type /Page\n%%EOF';
    const mockFile = {
      name: 'test.pdf',
      _content: noCountPdfContent
    } as any;

    const count = await countPdfPages(mockFile);
    expect(count).toBe(3);
  });

  it('validateFiles - should pass for valid inputs within size, count, and page limits', () => {
    const files = [
      { name: 'file1.pdf', size: 10 * 1024 * 1024 } as File,
      { name: 'image2.png', size: 5 * 1024 * 1024 } as File
    ];
    const pdfPageCounts = {
      'file1.pdf': 10
    };

    const res = validateFiles(files, pdfPageCounts);
    expect(res.isValid).toBe(true);
    expect(res.errors.length).toBe(0);
    expect(res.generalError).toBeUndefined();
  });

  it('validateFiles - should fail when a single file size exceeds 50MB limit', () => {
    const files = [
      { name: 'big_file.pdf', size: 51 * 1024 * 1024 } as File
    ];
    const pdfPageCounts = {
      'big_file.pdf': 5
    };

    const res = validateFiles(files, pdfPageCounts);
    expect(res.isValid).toBe(false);
    expect(res.errors[0].fileName).toBe('big_file.pdf');
    expect(res.errors[0].error).toContain('Exceeds single file size limit');
  });

  it('validateFiles - should fail when total files count exceeds 20 files limit', () => {
    const files: File[] = Array.from({ length: 21 }, (_, i) => ({
      name: `file_${i}.png`,
      size: 1 * 1024 * 1024
    } as File));

    const res = validateFiles(files, {});
    expect(res.isValid).toBe(false);
    expect(res.generalError).toContain('Too many files');
  });

  it('validateFiles - should fail when total request size exceeds 200MB limit', () => {
    const files = [
      { name: 'file1.pdf', size: 110 * 1024 * 1024 } as File,
      { name: 'file2.pdf', size: 100 * 1024 * 1024 } as File
    ];
    const pdfPageCounts = {
      'file1.pdf': 10,
      'file2.pdf': 20
    };

    const res = validateFiles(files, pdfPageCounts);
    expect(res.isValid).toBe(false);
    expect(res.generalError).toContain('Total request size');
  });

  it('validateFiles - should fail when a PDF page count exceeds 200 pages limit', () => {
    const files = [
      { name: 'long.pdf', size: 10 * 1024 * 1024 } as File
    ];
    const pdfPageCounts = {
      'long.pdf': 201
    };

    const res = validateFiles(files, pdfPageCounts);
    expect(res.isValid).toBe(false);
    expect(res.errors[0].fileName).toBe('long.pdf');
    expect(res.errors[0].error).toContain('Exceeds maximum PDF page count limit');
  });
});

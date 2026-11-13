import zlib from 'node:zlib';
import mongoose from 'mongoose';
import User from '../models/User';
import StudentMapping from '../models/StudentMapping';
import Grade from '../models/Grade';
import { IExam } from '../models/Exam';
import studentResultService from '../services/StudentResultService';

export interface ExamGradeExportData {
    headers: string[];
    rows: (string | number)[][];
    examTitle: string;
}

/**
 * Escapes special XML characters to prevent XML injection / malformed XML.
 */
export function escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, c => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
}

/**
 * Converts a 1-based column index to an Excel column letter (e.g. 1 -> A, 27 -> AA).
 */
export function colToLetter(index: number): string {
    let temp = index;
    let letter = '';
    while (temp > 0) {
        const mod = (temp - 1) % 26;
        letter = String.fromCharCode(65 + mod) + letter;
        temp = Math.floor((temp - mod) / 26);
    }
    return letter;
}

/**
 * Sanitizes cell values to prevent CSV and spreadsheet formula injection.
 * Any string starting with =, +, -, @, tab, or carriage return is prefixed with a single quote.
 */
export function sanitizeSpreadsheetCell(value: unknown): string {
    const raw = value === null || value === undefined ? '' : String(value);
    return /^[\s\uFEFF]*[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
}

/**
 * Formats a single cell for CSV output following RFC 4180 with formula injection protection.
 */
export function csvCell(value: unknown): string {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? String(value) : '';
    }
    const safe = sanitizeSpreadsheetCell(value);
    return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Builds an RFC 4180 compliant CSV string from headers and data rows.
 */
export function buildCsv(headers: string[], rows: (string | number)[][]): string {
    const headerRow = headers.map(csvCell).join(',') + '\r\n';
    const dataRows = rows.map(row => row.map(csvCell).join(',') + '\r\n').join('');
    return headerRow + dataRows;
}

/**
 * Builds a valid PKZIP 2.0 archive from the given file entries.
 */
export function buildZip(files: Array<{ name: string; content: string | Buffer }>): Buffer {
    const localHeaders: Buffer[] = [];
    const centralHeaders: Buffer[] = [];
    let offset = 0;

    for (const file of files) {
        const nameBuf = Buffer.from(file.name, 'utf8');
        const data = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8');
        const compressed = zlib.deflateRawSync(data);
        const crc = zlib.crc32(data);

        // Local file header (30 bytes + name length)
        const lh = Buffer.alloc(30 + nameBuf.length);
        lh.writeUInt32LE(0x04034b50, 0); // signature
        lh.writeUInt16LE(20, 4); // version needed (2.0)
        lh.writeUInt16LE(0x0800, 6); // flags (bit 11 = UTF-8)
        lh.writeUInt16LE(8, 8); // compression = deflate
        lh.writeUInt16LE(0, 10); // mod time
        lh.writeUInt16LE(0, 12); // mod date
        lh.writeUInt32LE(crc, 14);
        lh.writeUInt32LE(compressed.length, 18);
        lh.writeUInt32LE(data.length, 22);
        lh.writeUInt16LE(nameBuf.length, 26);
        lh.writeUInt16LE(0, 28); // extra field length
        nameBuf.copy(lh, 30);
        localHeaders.push(lh, compressed);

        // Central directory header (46 bytes + name length)
        const ch = Buffer.alloc(46 + nameBuf.length);
        ch.writeUInt32LE(0x02014b50, 0); // signature
        ch.writeUInt16LE(20, 4); // version made by
        ch.writeUInt16LE(20, 6); // version needed
        ch.writeUInt16LE(0x0800, 8); // flags
        ch.writeUInt16LE(8, 10); // compression = deflate
        ch.writeUInt16LE(0, 12); // mod time
        ch.writeUInt16LE(0, 14); // mod date
        ch.writeUInt32LE(crc, 16);
        ch.writeUInt32LE(compressed.length, 20);
        ch.writeUInt32LE(data.length, 24);
        ch.writeUInt16LE(nameBuf.length, 28);
        ch.writeUInt16LE(0, 30); // extra len
        ch.writeUInt16LE(0, 32); // comment len
        ch.writeUInt16LE(0, 34); // disk start
        ch.writeUInt16LE(0, 36); // internal file attr
        ch.writeUInt32LE(0, 38); // external file attr
        ch.writeUInt32LE(offset, 42); // relative offset of local header
        nameBuf.copy(ch, 46);
        centralHeaders.push(ch);

        offset += lh.length + compressed.length;
    }

    const centralDirOffset = offset;
    const centralDirSize = centralHeaders.reduce((sum, h) => sum + h.length, 0);

    // End of central directory record (22 bytes)
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4); // disk number
    eocd.writeUInt16LE(0, 6); // start disk
    eocd.writeUInt16LE(files.length, 8); // entries on disk
    eocd.writeUInt16LE(files.length, 10); // total entries
    eocd.writeUInt32LE(centralDirSize, 12);
    eocd.writeUInt32LE(centralDirOffset, 16);
    eocd.writeUInt16LE(0, 20); // comment length

    return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

/**
 * Builds an OpenXML spreadsheet (.xlsx) buffer with formula injection protection.
 */
export function buildXlsx(headers: string[], rows: (string | number)[][]): Buffer {
    let sheetData = '';

    // Header row (row 1)
    sheetData += '<row r="1">';
    headers.forEach((h, i) => {
        const col = colToLetter(i + 1);
        sheetData += `<c r="${col}1" t="inlineStr"><is><t>${escapeXml(h)}</t></is></c>`;
    });
    sheetData += '</row>';

    // Data rows (rows 2..)
    rows.forEach((row, rowIdx) => {
        const rNum = rowIdx + 2;
        sheetData += `<row r="${rNum}">`;
        row.forEach((val, colIdx) => {
            const col = colToLetter(colIdx + 1);
            if (typeof val === 'number' && Number.isFinite(val)) {
                sheetData += `<c r="${col}${rNum}" t="n"><v>${val}</v></c>`;
            } else {
                const safe = sanitizeSpreadsheetCell(val);
                sheetData += `<c r="${col}${rNum}" t="inlineStr"><is><t>${escapeXml(safe)}</t></is></c>`;
            }
        });
        sheetData += '</row>';
    });

    const sheet1Xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n' +
        '  <sheetData>' + sheetData + '</sheetData>\n' +
        '</worksheet>';

    const contentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
        '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
        '  <Default Extension="xml" ContentType="application/xml"/>\n' +
        '  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\n' +
        '  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\n' +
        '</Types>';

    const relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
        '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\n' +
        '</Relationships>';

    const workbookXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n' +
        '  <sheets>\n' +
        '    <sheet name="Grades" sheetId="1" r:id="rId1"/>\n' +
        '  </sheets>\n' +
        '</workbook>';

    const workbookRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
        '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>\n' +
        '</Relationships>';

    return buildZip([
        { name: '[Content_Types].xml', content: contentTypesXml },
        { name: '_rels/.rels', content: relsXml },
        { name: 'xl/workbook.xml', content: workbookXml },
        { name: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml },
        { name: 'xl/worksheets/sheet1.xml', content: sheet1Xml }
    ]);
}

/**
 * Loads and structures released grade export data for an exam.
 * Only released student results fulfilling all release conditions are included.
 */
export async function getExamGradeExportData(exam: IExam): Promise<ExamGradeExportData> {
    const releasedScores = await studentResultService.getPublishedExamScores(exam);
    const questionScores = await studentResultService.getPublishedExamQuestionScores(
        exam,
        releasedScores.map(result => result.scriptId)
    );

    const questions = questionScores.questions;
    const studentObjectIds = releasedScores.map(r => new mongoose.Types.ObjectId(r.studentId));
    const scriptObjectIds = releasedScores.map(r => new mongoose.Types.ObjectId(r.scriptId));

    const [users, mappings, grades] = await Promise.all([
        studentObjectIds.length > 0
            ? User.find({ _id: { $in: studentObjectIds } }).select('_id name email').lean()
            : [],
        studentObjectIds.length > 0
            ? StudentMapping.find({ exam: exam._id, student: { $in: studentObjectIds } }).select('student rollNumber anonymousId').lean()
            : [],
        scriptObjectIds.length > 0
            ? Grade.find({ answerScript: { $in: scriptObjectIds }, isFinal: true }).select('answerScript question totalScore').lean()
            : []
    ]);

    const userById = new Map(users.map(u => [u._id.toString(), u]));
    const mappingByStudentId = new Map(mappings.map(m => [m.student.toString(), m]));

    // Map scriptId:questionNumber -> score
    const gradesByScriptAndQuestion = new Map<string, number>();
    for (const grade of grades) {
        if (grade.answerScript && typeof grade.question === 'number' && Number.isFinite(grade.totalScore)) {
            gradesByScriptAndQuestion.set(`${grade.answerScript.toString()}:${grade.question}`, grade.totalScore);
        }
    }

    // Build headers
    const headers = [
        'Student ID',
        'Roll Number',
        'Student Name',
        'Email',
        'Anonymous ID',
        ...questions.map(q => `Q${q.questionNumber}`),
        'Total Score',
        'Max Marks',
        'Percentage'
    ];

    // Build rows
    const rows: (string | number)[][] = [];
    for (const item of releasedScores) {
        const user = userById.get(item.studentId);
        const mapping = mappingByStudentId.get(item.studentId);
        const studentName = user?.name || '';
        const studentEmail = user?.email || '';
        const rollNumber = mapping?.rollNumber || '';
        const anonymousId = mapping?.anonymousId || '';

        const questionValues: (string | number)[] = questions.map(q => {
            const key = `${item.scriptId}:${q.questionNumber}`;
            const score = gradesByScriptAndQuestion.get(key);
            return score !== undefined ? score : '';
        });

        const percentage = item.maxMarks > 0
            ? Math.round(((item.score / item.maxMarks) * 100) * 100) / 100
            : 0;

        rows.push([
            item.studentId,
            rollNumber,
            studentName,
            studentEmail,
            anonymousId,
            ...questionValues,
            item.score,
            item.maxMarks,
            percentage
        ]);
    }

    // Sort rows by rollNumber if available, otherwise studentName
    rows.sort((a, b) => {
        const rollA = String(a[1] || '');
        const rollB = String(b[1] || '');
        if (rollA && rollB) {
            return rollA.localeCompare(rollB, undefined, { numeric: true });
        }
        if (rollA) return -1;
        if (rollB) return 1;
        const nameA = String(a[2] || '');
        const nameB = String(b[2] || '');
        return nameA.localeCompare(nameB);
    });

    return {
        headers,
        rows,
        examTitle: exam.title
    };
}


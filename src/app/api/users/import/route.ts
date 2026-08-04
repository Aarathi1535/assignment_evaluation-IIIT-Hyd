import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import UserService from '@/services/UserService';
import { createUserSchema } from '@/validations/userValidation';
import { requirePermission } from '@/lib/apiAuth';
import { Permission, UserRole } from '@/constants/permissions';
import { parse } from 'csv-parse/sync';

export async function POST(req: NextRequest) {
  const auth = await requirePermission(Permission.MANAGE_USERS);
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    await connectDB();

    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({
        success: false,
        message: 'Content type must be multipart/form-data',
        data: null
      }, { status: 400 });
    }

    const formData = await req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json({
        success: false,
        message: 'CSV file is required',
        data: null
      }, { status: 400 });
    }

    const csvContent = await file.text();
    if (!csvContent.trim()) {
      return NextResponse.json({
        success: true,
        message: 'Import process completed',
        data: {
          imported: 0,
          failed: 0,
          errors: []
        }
      }, { status: 200 });
    }

    let records: Record<string, unknown>[];
    try {
      records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });
    } catch (parseError: unknown) {
      const errMsg = parseError instanceof Error ? parseError.message : 'Unknown parse error';
      return NextResponse.json({
        success: false,
        message: `Failed to parse CSV: ${errMsg}`,
        data: null
      }, { status: 400 });
    }

    if (records.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Import process completed',
        data: {
          imported: 0,
          failed: 0,
          errors: []
        }
      }, { status: 200 });
    }

    // Verify headers: expected columns: name, email, password, role
    const headers = Object.keys(records[0]);
    const requiredHeaders = ['name', 'email', 'password', 'role'];
    const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
    if (missingHeaders.length > 0) {
      return NextResponse.json({
        success: false,
        message: `CSV headers must include name, email, password, role`,
        data: null
      }, { status: 400 });
    }

    let imported = 0;
    let failed = 0;
    const errors: { row: number; email: string; errors: string[] }[] = [];

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const rowNum = i + 2; // Row 1 is header, index 0 is Row 2
      const email = typeof record.email === 'string' ? record.email.trim() : '';

      // Zod validation
      const validationResult = createUserSchema.safeParse(record);
      if (!validationResult.success) {
        failed++;
        const rowErrors = validationResult.error.issues.map(err => err.message);
        errors.push({
          row: rowNum,
          email,
          errors: rowErrors
        });
        continue;
      }

      const userData = {
        ...validationResult.data,
        role: validationResult.data.role as UserRole
      };

      try {
        await UserService.createUser(userData);
        imported++;
      } catch (error: unknown) {
        failed++;
        const errMsg = error instanceof Error ? error.message : 'Unknown database error';
        errors.push({
          row: rowNum,
          email,
          errors: [errMsg]
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Import process completed',
      data: {
        imported,
        failed,
        errors
      }
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

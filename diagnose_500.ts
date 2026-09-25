/**
 * TEMPORARY DIAGNOSTIC - DELETE AFTER USE
 * Run: npx tsx diagnose_500.ts
 */

// Read .env.local without dotenv
import * as fs from 'fs';
const envLines = fs.readFileSync('.env.local', 'utf-8').split('\n');
for (const line of envLines) {
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
        const key = line.substring(0, eqIdx).trim();
        const val = line.substring(eqIdx + 1).trim();
        if (key) process.env[key] = val;
    }
}

import mongoose from 'mongoose';

async function diagnose() {
    const uri = process.env.MONGODB_URI || '';
    if (!uri) {
        console.error('MONGODB_URI not set in .env.local');
        process.exit(1);
    }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(uri);
    const db = mongoose.connection.db!;
    console.log('Connected to:', db.databaseName);

    // 1. Find professor accounts
    const professors = await db.collection('users').find({ role: 'PROFESSOR' }).toArray();
    console.log('\n=== PROFESSORS ===');
    professors.forEach(u => {
        const idStr = u._id.toString();
        console.log(`  id=${idStr} email=${u.email}`);
        console.log(`  isValidObjectId: ${mongoose.Types.ObjectId.isValid(idStr)}`);
    });

    // 2. Find courses
    const courses = await db.collection('courses').find({}).toArray();
    console.log('\n=== COURSES ===');
    courses.forEach(c => {
        const courseIdStr = c._id.toString();
        const profId = c.professor?.toString() ?? 'null';
        console.log(`  id=${courseIdStr} code=${c.courseCode} professor=${profId}`);
        console.log(`  isValid courseId: ${mongoose.Types.ObjectId.isValid(courseIdStr)}, isValid profId: ${mongoose.Types.ObjectId.isValid(profId)}`);
    });

    // 3. Find syllabi
    const syllabi = await db.collection('coursesyllabuses').find({}).toArray();
    console.log('\n=== SYLLABI (coursesyllabuses) ===');
    if (syllabi.length === 0) console.log('  (none)');
    syllabi.forEach(s => {
        console.log(`  id=${s._id} course=${s.course?.toString()} title="${s.title}" units=${s.units?.length}`);
    });

    // 4. Find personalized schedules
    const schedules = await db.collection('personalizedassessmentschedules').find({}).toArray();
    console.log('\n=== PERSONALIZED SCHEDULES ===');
    if (schedules.length === 0) console.log('  (none)');
    schedules.forEach(s => {
        const createdBy = s.createdBy?.toString() ?? 'null';
        console.log(`  id=${s._id} title="${s.title}" createdBy=${createdBy} isValidCreatedBy=${mongoose.Types.ObjectId.isValid(createdBy)}`);
    });

    // 5. Simulate GET requests for first professor + first course
    if (professors.length > 0) {
        const prof = professors[0];
        const profIdStr = prof._id.toString();
        const isValid = mongoose.Types.ObjectId.isValid(profIdStr);
        console.log(`\n=== SIMULATING for professor "${prof.email}" id="${profIdStr}" isValid=${isValid} ===`);

        try {
            const profSchedules = await db.collection('personalizedassessmentschedules')
                .find({ createdBy: new mongoose.Types.ObjectId(profIdStr) }).toArray();
            console.log(`  GET /schedules -> OK (${profSchedules.length} schedules)`);
        } catch (e) {
            console.error(`  GET /schedules -> ERROR:`, e);
        }

        if (courses.length > 0) {
            const firstCourse = courses[0];
            const courseIdStr = firstCourse._id.toString();
            console.log(`\n  Using course "${firstCourse.courseCode}" id="${courseIdStr}"`);

            try {
                const syl = await db.collection('coursesyllabuses').findOne({ course: new mongoose.Types.ObjectId(courseIdStr) });
                console.log(`  GET /syllabus?courseId=${courseIdStr} -> ${syl ? 'FOUND' : 'NOT FOUND'}`);
            } catch (e) {
                console.error(`  GET /syllabus -> ERROR:`, e);
            }

            try {
                const qcount = await db.collection('personalizedquestions').countDocuments({ course: new mongoose.Types.ObjectId(courseIdStr) });
                console.log(`  GET /questions?courseId=${courseIdStr} -> ${qcount} questions`);
            } catch (e) {
                console.error(`  GET /questions -> ERROR:`, e);
            }
        }
    }

    // 6. List all DB collections
    const collections = await db.listCollections().toArray();
    console.log('\n=== ALL DB COLLECTIONS ===');
    collections.forEach(c => console.log('  ', c.name));

    await mongoose.disconnect();
    console.log('\nDiagnosis complete.');
}

diagnose().catch(err => {
    console.error('Diagnosis failed:', err);
    process.exit(1);
});

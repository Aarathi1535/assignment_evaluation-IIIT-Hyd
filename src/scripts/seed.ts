import { loadEnvConfig } from '@next/env';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import type { UserRole } from '../models/User';

// Load env files (.env.local, etc.) before importing db config
loadEnvConfig(process.cwd());

const usersToSeed = [
  {
    name: 'Default Admin',
    email: 'admin@university.edu',
    password: 'admin-secure-password',
    role: 'ADMIN',
  },
  {
    name: 'Default Professor',
    email: 'professor@university.edu',
    password: 'professor-secure-password',
    role: 'PROFESSOR',
  },
  {
    name: 'Default TA',
    email: 'ta@university.edu',
    password: 'ta-secure-password',
    role: 'TA',
  },
  {
    name: 'Default Student',
    email: 'student@university.edu',
    password: 'student-secure-password',
    role: 'STUDENT',
  },
];

async function seed() {
  try {
    // Dynamic import to prevent env.ts load validation errors before loadEnvConfig runs
    const { connectDB } = await import('../lib/db');
    const { default: User } = await import('../models/User');

    console.log('Connecting to database...');
    await connectDB();
    console.log('Database connected.');

    for (const u of usersToSeed) {
      const email = u.email.toLowerCase();
      const existing = await User.findOne({ email });

      if (existing) {
        console.log(`User with email ${email} already exists. Skipping.`);
        continue;
      }

      const hashedPassword = await bcrypt.hash(u.password, 10);
      await User.create({
        name: u.name,
        email,
        password: hashedPassword,
        role: u.role as UserRole,
        isActive: true,
      });

      console.log(`Seeded user: ${email} (${u.role})`);
    }

    console.log('Seeding completed successfully!');
  } catch (error) {
    console.error('Error seeding database:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed.');
  }
}

seed();

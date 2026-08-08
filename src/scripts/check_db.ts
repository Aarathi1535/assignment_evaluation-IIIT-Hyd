import { loadEnvConfig } from '@next/env';

// Load environment configuration (.env.local) if present
loadEnvConfig(process.cwd());

async function run() {
  const { connectDB } = await import('../lib/db');
  const { default: User } = await import('../models/User');
  const mongoose = await import('mongoose');

  await connectDB();

  const users = await User.find({}).lean();

  console.log(
    users.map(u => ({
      email: u.email,
      role: u.role,
      name: u.name,
    }))
  );

  await mongoose.connection.close();
}

run().catch(console.error);

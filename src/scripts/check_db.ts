process.env.MONGODB_URI = 'mongodb+srv://ballaaarathi15_db_user:ammu1535@cluster0.wsznwos.mongodb.net/assignment-evaluator?retryWrites=true&w=majority&appName=Cluster0';
process.env.NEXTAUTH_SECRET = 'another-long-random-secret';
process.env.NEXTAUTH_URL = 'http://localhost:3000';

async function run() {
  const { connectDB } = await import('../lib/db');
  const { default: User } = await import('../models/User');
  const mongoose = await import('mongoose');

  await connectDB();
  const users = await User.find({}).lean();
  console.log('Users in database:', users.map(u => ({ email: u.email, role: u.role, name: u.name })));
  await mongoose.connection.close();
}

run().catch(console.error);

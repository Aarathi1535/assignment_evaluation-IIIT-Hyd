import { AuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { connectDB } from './db';
import User, { UserRole } from '../models/User';

export const authOptions: AuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Please enter your email and password');
        }

        await connectDB();

        const user = await User.findOne({ email: credentials.email.toLowerCase() });

        if (!user) {
          throw new Error('No user found with this email');
        }

        if (!user.isActive) {
          const { writeAuditLog } = await import('./audit');
          await writeAuditLog({
            user: user._id,
            action: 'LOGIN_FAILURE',
            outcome: 'FAILURE',
            details: { email: credentials.email.toLowerCase(), reason: 'User is inactive' }
          });
          throw new Error('No user found with this email');
        }

        const isPasswordCorrect = await bcrypt.compare(credentials.password, user.password);

        if (!isPasswordCorrect) {
          const { writeAuditLog } = await import('./audit');
          await writeAuditLog({
            user: user._id,
            action: 'LOGIN_FAILURE',
            outcome: 'FAILURE',
            details: { email: credentials.email.toLowerCase(), reason: 'Incorrect password' }
          });
          throw new Error('Incorrect password');
        }

        const { writeAuditLog } = await import('./audit');
        await writeAuditLog({
          user: user._id,
          action: 'LOGIN_SUCCESS',
          outcome: 'SUCCESS',
          details: { email: user.email }
        });

        return {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
          role: user.role as UserRole,
        };
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as import('next-auth').User).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user = {
          ...session.user,
          id: token.id as string,
          role: token.role as string,
        } as import('next-auth').Session['user'];
      }
      return session;
    }
  },
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  events: {
    async signOut({ token }) {
      if (token && token.id) {
        const { writeAuditLog } = await import('./audit');
        await writeAuditLog({
          user: token.id as string,
          action: 'LOGOUT',
          outcome: 'SUCCESS'
        });
      }
    }
  },
  secret: process.env.NEXTAUTH_SECRET,
};

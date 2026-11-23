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
          classroomAccess: Boolean(user.classroomAccess),
          classroomRequestStatus: user.classroomRequestStatus || 'NONE',
          personalizedAccess: Boolean(user.personalizedAccess),
          personalizedRequestStatus: user.personalizedRequestStatus || 'NONE',
          section: user.section || null,
        } as any;
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
        token.classroomAccess = (user as any).classroomAccess;
        token.classroomRequestStatus = (user as any).classroomRequestStatus;
        token.personalizedAccess = (user as any).personalizedAccess;
        token.personalizedRequestStatus = (user as any).personalizedRequestStatus;
        token.section = (user as any).section;
      } else if (token.id) {
        // Refresh permissions from DB so admin access grants reflect immediately
        try {
          const { default: UserModel } = await import('@/models/User');
          const latest = await UserModel.findById(token.id).select('classroomAccess classroomRequestStatus personalizedAccess personalizedRequestStatus section').lean();
          if (latest) {
            token.classroomAccess = Boolean((latest as any).classroomAccess);
            token.classroomRequestStatus = (latest as any).classroomRequestStatus || 'NONE';
            token.personalizedAccess = Boolean((latest as any).personalizedAccess);
            token.personalizedRequestStatus = (latest as any).personalizedRequestStatus || 'NONE';
            token.section = (latest as any).section || null;
          }
        } catch {
          // Non-blocking
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user = {
          ...session.user,
          id: token.id as string,
          role: token.role as string,
          classroomAccess: Boolean(token.classroomAccess),
          classroomRequestStatus: (token.classroomRequestStatus as string) || 'NONE',
          personalizedAccess: Boolean(token.personalizedAccess),
          personalizedRequestStatus: (token.personalizedRequestStatus as string) || 'NONE',
          section: (token.section as string) || null,
        } as any;
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

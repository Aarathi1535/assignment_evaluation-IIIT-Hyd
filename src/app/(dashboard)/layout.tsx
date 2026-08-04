'use client';

import React, { useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { 
  LayoutDashboard, 
  BookOpen, 
  Menu, 
  X, 
  LogOut, 
  GraduationCap,
  Users,
  LucideIcon
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface NavLinksProps {
  menuItems: Array<{ label: string; href: string; icon: LucideIcon }>;
  pathname: string;
  onClickItem?: () => void;
}

const NavLinks = ({ menuItems, pathname, onClickItem }: NavLinksProps) => {
  return (
    <nav className="flex-1 px-4 py-6 space-y-1">
      {menuItems.map((item) => {
        const Icon = item.icon;
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onClickItem}
            className={`flex items-center gap-3 px-4 py-3 rounded-brand text-sm font-semibold transition-all duration-200 ${
              isActive
                ? 'bg-brand-primary/10 text-brand-primary border-l-4 border-brand-primary pl-3'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <Icon className={`h-5 w-5 shrink-0 ${isActive ? 'text-brand-primary' : 'text-slate-400'}`} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
};

interface ProfileFooterProps {
  user: {
    name?: string | null;
    email?: string | null;
  };
  roleLabel: string;
  badgeStyle: string;
  onSignOut: () => void;
}

const ProfileFooter = ({ user, roleLabel, badgeStyle, onSignOut }: ProfileFooterProps) => (
  <div className="p-4 border-t border-slate-200 bg-white">
    <div className="flex items-center gap-3 mb-3">
      <div className="h-10 w-10 rounded-full bg-brand-primary/10 text-brand-primary flex items-center justify-center font-bold text-lg select-none">
        {user.name ? user.name.charAt(0).toUpperCase() : user.email?.charAt(0).toUpperCase() || 'U'}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-900 truncate">{user.name || 'User'}</p>
        <p className="text-xs text-slate-500 truncate mb-1">{user.email}</p>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-extrabold tracking-wide uppercase ${badgeStyle}`}>
          {roleLabel}
        </span>
      </div>
    </div>
    <button
      onClick={onSignOut}
      className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-slate-200 rounded-brand text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer animate-none"
    >
      <LogOut className="h-4 w-4 text-slate-400" />
      <span>Sign Out</span>
    </button>
  </div>
);

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, status } = useSession();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-3">
          <LoadingSpinner size="lg" />
          <p className="text-sm font-semibold text-slate-500">Loading your workspace...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return null; // The middleware in proxy.ts handles redirects
  }

  const user = session.user;
  const rawRole = user.role || 'STUDENT';
  const role = rawRole.toUpperCase();

  // Define navigation items per role
  const navItemsByRole: Record<string, Array<{ label: string; href: string; icon: LucideIcon }>> = {
    ADMIN: [
      { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
      { label: 'Users', href: '/admin/users', icon: Users },
    ],
    PROFESSOR: [
      { label: 'Dashboard', href: '/professor', icon: LayoutDashboard },
      { label: 'Create Course', href: '/professor/courses/create', icon: BookOpen },
    ],
    TA: [
      { label: 'Dashboard', href: '/ta', icon: LayoutDashboard },
    ],
    STUDENT: [
      { label: 'Dashboard', href: '/student', icon: LayoutDashboard },
    ],
  };

  const menuItems = navItemsByRole[role] || navItemsByRole.STUDENT;

  const roleBadgeStyles: Record<string, string> = {
    ADMIN: 'bg-rose-50 text-rose-700 border-rose-200 border',
    PROFESSOR: 'bg-indigo-50 text-indigo-700 border-indigo-200 border',
    TA: 'bg-purple-50 text-purple-700 border-purple-200 border',
    STUDENT: 'bg-emerald-50 text-emerald-700 border-emerald-200 border',
  };

  const badgeStyle = roleBadgeStyles[role] || roleBadgeStyles.STUDENT;
  const roleLabel = role.charAt(0) + role.slice(1).toLowerCase();

  const handleSignOut = () => {
    signOut({ callbackUrl: '/login' });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-white border-r border-slate-200 z-20">
        {/* Sidebar Header */}
        <div className="h-16 flex items-center gap-3 px-6 border-b border-slate-200 bg-white select-none">
          <div className="h-9 w-9 rounded-brand bg-brand-primary flex items-center justify-center text-white">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-sm font-black text-slate-900 tracking-tight leading-none">IIIT Hyderabad</h1>
            <p className="text-3xs font-extrabold text-brand-primary uppercase tracking-widest mt-1">Evaluator</p>
          </div>
        </div>

        {/* Sidebar Links */}
        <NavLinks menuItems={menuItems} pathname={pathname} />

        {/* Sidebar Profile & Signout */}
        <ProfileFooter 
          user={user} 
          roleLabel={roleLabel} 
          badgeStyle={badgeStyle} 
          onSignOut={handleSignOut} 
        />
      </aside>

      {/* Mobile Top Header */}
      <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="flex items-center gap-2.5 select-none">
          <div className="h-8 w-8 rounded bg-brand-primary flex items-center justify-center text-white">
            <GraduationCap className="h-4.5 w-4.5" />
          </div>
          <div>
            <h1 className="text-xs font-black text-slate-900 tracking-tight leading-none">IIIT Hyderabad</h1>
            <p className="text-4xs font-extrabold text-brand-primary uppercase tracking-widest mt-0.5">Evaluator</p>
          </div>
        </div>
        <button
          onClick={() => setIsMobileMenuOpen(true)}
          className="p-1.5 rounded-brand hover:bg-slate-100 text-slate-600 cursor-pointer"
          aria-label="Open menu"
        >
          <Menu className="h-6 w-6" />
        </button>
      </header>

      {/* Mobile Navigation Drawer Overlay */}
      {isMobileMenuOpen && (
        <div className="lg:hidden">
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-40 transition-opacity duration-300"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          
          {/* Drawer Menu */}
          <div className="fixed inset-y-0 left-0 w-64 bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300">
            {/* Drawer Header */}
            <div className="h-16 flex items-center justify-between px-6 border-b border-slate-200">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded bg-brand-primary flex items-center justify-center text-white">
                  <GraduationCap className="h-4.5 w-4.5" />
                </div>
                <div>
                  <h1 className="text-xs font-black text-slate-900 tracking-tight leading-none">IIIT Hyderabad</h1>
                  <p className="text-4xs font-extrabold text-brand-primary uppercase tracking-widest mt-0.5">Evaluator</p>
                </div>
              </div>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-1.5 rounded hover:bg-slate-100 text-slate-600 cursor-pointer"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Drawer Links */}
            <NavLinks 
              menuItems={menuItems} 
              pathname={pathname} 
              onClickItem={() => setIsMobileMenuOpen(false)} 
            />

            {/* Drawer Profile & Signout */}
            <ProfileFooter 
              user={user} 
              roleLabel={roleLabel} 
              badgeStyle={badgeStyle} 
              onSignOut={handleSignOut} 
            />
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="lg:pl-64 flex flex-col min-h-screen">
        <main className="flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}

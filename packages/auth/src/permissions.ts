import { PlatformRole } from './types';

export const ROLE_PERMISSIONS: Record<PlatformRole, string[]> = {
  ADMIN: [
    'users:manage',
    'courses:manage',
    'apiclients:manage',
    'federation:manage',
    'system:admin',
    'exams:view',
    'exams:manage',
    'classroom:manage',
    'practice:manage',
  ],
  PROFESSOR: [
    'courses:view',
    'exams:create',
    'exams:manage',
    'allocations:manage',
    'grading:approve',
    'regrades:decide',
    'classroom:sessions:create',
    'classroom:sessions:manage',
    'classroom:results:publish',
    'practice:questions:manage',
    'practice:questions:approve',
    'practice:analytics:view',
  ],
  TA: [
    'courses:view',
    'exams:view',
    'grading:perform',
    'regrades:review',
    'classroom:sessions:assist',
    'practice:questions:review',
  ],
  STUDENT: [
    'courses:view_enrolled',
    'exams:view_results',
    'regrades:request',
    'classroom:participate',
    'classroom:submit',
    'practice:daily:take',
    'practice:progress:view',
  ],
};

export function hasPermission(role: PlatformRole, requiredPermission: string): boolean {
  const permissions = ROLE_PERMISSIONS[role] || [];
  return permissions.includes(requiredPermission) || permissions.includes('system:admin');
}

export function hasAnyPermission(role: PlatformRole, requiredPermissions: string[]): boolean {
  return requiredPermissions.some((p) => hasPermission(role, p));
}

export function hasAllPermissions(role: PlatformRole, requiredPermissions: string[]): boolean {
  return requiredPermissions.every((p) => hasPermission(role, p));
}

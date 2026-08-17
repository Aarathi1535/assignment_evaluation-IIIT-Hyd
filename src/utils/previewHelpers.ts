import { Permission, UserRole, hasPermission } from '@/constants/permissions';

export interface PageInfo {
  _id: string;
  pageNumber: number;
  fileIndex: number;
  thumbnailUrl: string;
  width?: number;
  height?: number;
}

export interface ScriptInfo {
  _id: string;
  __v?: number;
  exam: string;
  student?: string | null;
  candidateStudentId?: string | null;
  identificationSource?: string | null;
  identificationStatus?: 'IDENTIFIED' | 'UNIDENTIFIED' | null;
  needsManualId?: boolean;
  manualIdReason?: string | null;
  fileIndex: number;
  startPageNumber: number;
  endPageNumber: number;
  pageCount: number;
  pages: PageInfo[];
}

/**
 * Validates that no page is duplicated across multiple scripts.
 */
export function validateDataIntegrity(scripts: ScriptInfo[]): {
  isValid: boolean;
  duplicatePageIds: string[];
} {
  const seenIds = new Set<string>();
  const duplicateIds = new Set<string>();

  for (const script of scripts) {
    if (!script.pages) continue;
    for (const page of script.pages) {
      if (!page._id) continue;
      const id = page._id.toString();
      if (seenIds.has(id)) {
        duplicateIds.add(id);
      } else {
        seenIds.add(id);
      }
    }
  }

  return {
    isValid: duplicateIds.size === 0,
    duplicatePageIds: Array.from(duplicateIds)
  };
}

/**
 * Verifies that the user role has the required EDIT_EXAM permission.
 */
export function checkOperatorPermission(role?: string): boolean {
  if (!role) return false;
  const upperRole = role.toUpperCase() as UserRole;
  return hasPermission(upperRole, Permission.EDIT_EXAM);
}

/**
 * Resolves the authenticated application-level thumbnail endpoint.
 */
export function getThumbnailUrl(batchId: string, pageId: string): string {
  return `/api/ingest/${batchId}/pages/${pageId}/thumbnail`;
}

/**
 * Returns user-friendly badge configuration based on identification status.
 */
export function getIdentificationBadgeConfig(script: ScriptInfo): {
  label: string;
  variant: 'success' | 'warning' | 'danger';
  description: string;
} {
  if (script.identificationStatus === 'IDENTIFIED' && script.candidateStudentId) {
    return {
      label: 'Identified',
      variant: 'success',
      description: `Student ID: ${script.candidateStudentId}`
    };
  }

  const reason = script.manualIdReason || 'Unknown reason';
  let friendlyReason = 'No candidate code found on cover page';
  if (script.manualIdReason === 'MULTIPLE_CODES') friendlyReason = 'Multiple student codes detected';
  if (script.manualIdReason === 'NOT_IN_ROSTER') friendlyReason = 'Student code not found in roster';
  if (script.manualIdReason === 'DUPLICATE_STUDENT') friendlyReason = 'Another script already mapped to this student';
  if (script.manualIdReason === 'INCOMPLETE_SCRIPT') friendlyReason = 'Incomplete or damaged script';

  return {
    label: 'Requires Manual Review',
    variant: 'warning',
    description: `Unidentified: ${friendlyReason} (${reason})`
  };
}

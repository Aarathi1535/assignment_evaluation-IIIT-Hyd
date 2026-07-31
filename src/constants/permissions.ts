import { UserRole } from '../models/User';

export enum Permission {
    MANAGE_USERS = 'MANAGE_USERS',
    CREATE_COURSE = 'CREATE_COURSE',
    EDIT_COURSE = 'EDIT_COURSE',
    CREATE_EXAM = 'CREATE_EXAM',
    EDIT_EXAM = 'EDIT_EXAM',
    UPLOAD_ANSWER_SHEETS = 'UPLOAD_ANSWER_SHEETS',
    START_AI_EVALUATION = 'START_AI_EVALUATION',
    REVIEW_EVALUATION = 'REVIEW_EVALUATION',
    PUBLISH_RESULTS = 'PUBLISH_RESULTS',
    VIEW_RESULTS = 'VIEW_RESULTS',
    REQUEST_REGRADE = 'REQUEST_REGRADE'
}

export const RolePermissions: Record<UserRole, Permission[]> = {
    [UserRole.ADMIN]: Object.values(Permission),
    [UserRole.PROFESSOR]: [
        Permission.CREATE_COURSE,
        Permission.EDIT_COURSE,
        Permission.CREATE_EXAM,
        Permission.EDIT_EXAM,
        Permission.UPLOAD_ANSWER_SHEETS,
        Permission.START_AI_EVALUATION,
        Permission.REVIEW_EVALUATION,
        Permission.PUBLISH_RESULTS,
        Permission.VIEW_RESULTS
    ],
    [UserRole.TA]: [
        Permission.UPLOAD_ANSWER_SHEETS,
        Permission.START_AI_EVALUATION,
        Permission.REVIEW_EVALUATION,
        Permission.VIEW_RESULTS
    ],
    [UserRole.STUDENT]: [
        Permission.VIEW_RESULTS,
        Permission.REQUEST_REGRADE
    ]
};

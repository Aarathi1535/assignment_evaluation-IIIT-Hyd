export enum UserRole {
    PROFESSOR = 'PROFESSOR',
    TA = 'TA',
    STUDENT = 'STUDENT',
    ADMIN = 'ADMIN'
}

export enum Permission {
    // Admin permissions
    MANAGE_USERS = 'MANAGE_USERS',
    
    // Course management
    CREATE_COURSE = 'CREATE_COURSE',
    EDIT_COURSE = 'EDIT_COURSE',
    DELETE_COURSE = 'DELETE_COURSE',
    ASSIGN_TAS = 'ASSIGN_TAS',

    // Exam management
    CREATE_EXAM = 'CREATE_EXAM',
    EDIT_EXAM = 'EDIT_EXAM',
    DELETE_EXAM = 'DELETE_EXAM',

    // Grading & Submissions
    VIEW_ALL_SUBMISSIONS = 'VIEW_ALL_SUBMISSIONS',
    VIEW_ASSIGNED_SCRIPTS = 'VIEW_ASSIGNED_SCRIPTS',
    GRADE_SCRIPT = 'GRADE_SCRIPT',
    ALLOCATE_SCRIPTS = 'ALLOCATE_SCRIPTS',
    FLAG_FOR_REVIEW = 'FLAG_FOR_REVIEW',
    SAVE_MARKS_FEEDBACK = 'SAVE_MARKS_FEEDBACK',
    PUBLISH_GRADES = 'PUBLISH_GRADES',

    // View permissions
    VIEW_ASSIGNED_COURSES = 'VIEW_ASSIGNED_COURSES',
    VIEW_OWN_RESULTS = 'VIEW_OWN_RESULTS',
    REQUEST_REGRADE = 'REQUEST_REGRADE'
}

export const RolePermissions: Record<UserRole, Permission[]> = {
    [UserRole.ADMIN]: Object.values(Permission),
    [UserRole.PROFESSOR]: [
        Permission.CREATE_COURSE,
        Permission.EDIT_COURSE,
        Permission.DELETE_COURSE,
        Permission.ASSIGN_TAS,
        Permission.CREATE_EXAM,
        Permission.EDIT_EXAM,
        Permission.DELETE_EXAM,
        Permission.VIEW_ALL_SUBMISSIONS,
        Permission.ALLOCATE_SCRIPTS,
        Permission.SAVE_MARKS_FEEDBACK,
        Permission.PUBLISH_GRADES,
        Permission.VIEW_ASSIGNED_COURSES
    ],
    [UserRole.TA]: [
        Permission.VIEW_ASSIGNED_COURSES,
        Permission.VIEW_ASSIGNED_SCRIPTS,
        Permission.GRADE_SCRIPT,
        Permission.FLAG_FOR_REVIEW,
        Permission.SAVE_MARKS_FEEDBACK
    ],
    [UserRole.STUDENT]: [
        Permission.VIEW_OWN_RESULTS,
        Permission.REQUEST_REGRADE
    ]
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
    return RolePermissions[role]?.includes(permission) || false;
}

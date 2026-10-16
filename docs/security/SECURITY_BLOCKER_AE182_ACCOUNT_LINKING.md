# Security Blocker: Unrestricted Self-Registration Role Assignment & Account Linking Risk

**Identifier:** SEC-BLOCKER-AE182-01  
**Associated Ticket:** AE-182  
**Component:** User Authentication & Registration (`src/app/api/auth/register/route.ts`, `src/validations/authValidation.ts`, `src/services/AuthService.ts`)  
**Severity:** Critical  

---

## 1. Vulnerability Summary

During implementation and security review for ticket **AE-182 (Student Results + Auth Scope)**, a critical security vulnerability was identified in the user registration flow:

The registration endpoint `/api/auth/register` accepts any arbitrary role parameter from the client without email verification, administrative approval, or domain restriction. An unauthenticated attacker can register an account with elevated privileges:
- `role: 'ADMIN'`
- `role: 'PROFESSOR'`
- `role: 'TA'`
- `role: 'STUDENT'`

Furthermore, because there is no email verification or institutional identity provider (SSO) binding, any user can register an arbitrary email address (e.g. impersonating a professor or student by email), immediately gaining authorization scoped to that email or student mapping.

---

## 2. Code Inspection & Proof of Issue

### A. Validation Schema: `src/validations/authValidation.ts`
```typescript
export const registerSchema = z.object({
  name: z.string().trim().min(3, { message: 'Name must be at least 3 characters long' }),
  email: z.string().trim().email({ message: 'Invalid email address' }),
  password: z.string().min(8, { message: 'Password must be at least 8 characters long' }),
  role: z.enum(['ADMIN', 'PROFESSOR', 'TA', 'STUDENT'], {
    message: 'Role must be one of: ADMIN, PROFESSOR, TA, STUDENT',
  }),
});
```
*Issue:* The schema explicitly permits client-supplied `ADMIN`, `PROFESSOR`, `TA`, or `STUDENT` roles.

### B. Registration Service: `src/services/AuthService.ts`
```typescript
class AuthService {
    async register(data: RegisterInput, ipAddress?: string): Promise<Omit<IUser, 'password'>> {
        const { email, password, name, role } = data;

        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            throw new HttpError("Email already registered", 409);
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        try {
            const user = await User.create({
                name,
                email,
                password: hashedPassword,
                role: role as UserRole
            });
...
```
*Issue:* The user record is created immediately with `isActive: true` (default in User model) and assigned the requested role without verification token or admin intervention.

---

## 3. Threat Model & Impact on Student Results (AE-182)

1. **Privilege Escalation:** An external attacker can register an account with `role: 'PROFESSOR'` or `role: 'ADMIN'`, granting them access to unpublished exams, student mappings, answer scripts, and grading rubrics.
2. **Account Linking & Identity Impersonation:** 
   - A malicious actor can register an account using a student's institutional email before the legitimate student registers.
   - When student mappings are imported via roster (`StudentMapping`), they link to the student's User ID or email. An imposter who registered that email address would then claim ownership of the answer scripts and results.
3. **Defense-in-Depth in AE-182:**
   - In ticket AE-182, we mitigated session tampering by:
     - Enforcing `STUDENT_RESULTS_ENABLED` feature flag (off by default in production).
     - Querying the database directly to verify the account is active and role is `STUDENT` on every request (not relying solely on client JWT tokens).
     - Rejecting client-supplied student IDs and resolving ownership strictly from the authenticated user's database record.
     - Enforcing identification status `IDENTIFIED`, absence of conflicts, and absence of manual ID flags.
   - However, until self-registration role selection and email verification are addressed, the registration flow remains an institutional security blocker.

---

## 4. Remediation Recommendations (Out of Scope for AE-182)

Per review instructions, AE-182 intentionally does not silently expand into a broad registration redesign. We recommend a dedicated security ticket with the following actions:
1. **Remove Role Selection from Public Registration:** Public registration should default strictly to `STUDENT` or a pending unverified role.
2. **Email Verification:** Require institutional email verification (e.g. 6-digit OTP or signed token link) before activating user accounts.
3. **Role Assignment via Admin / SSO:** Require `PROFESSOR`, `TA`, and `ADMIN` roles to be assigned exclusively by an administrator or provisioned via institutional SAML/OAuth2 (IIIT Hyderabad CAS/Google Workspace).

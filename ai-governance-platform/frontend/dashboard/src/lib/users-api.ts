import { createApiClient } from './http';
import type { UserRole } from './auth';

const gateway = createApiClient('/api');

export interface CompanyUser {
  email: string;
  givenName: string;
  familyName: string;
  role: UserRole;
  status: 'invited' | 'active' | 'disabled';
  invitedAt: string;
  invitedBy: string;
  lastSignInAt?: string;
}

export const listUsers = async () => (await gateway.get<{ managed: boolean; users: CompanyUser[] }>('/v1/users')).data;
export const inviteUser = async (input: { email: string; givenName: string; familyName: string; role: UserRole }) =>
  (await gateway.post<CompanyUser>('/v1/users', input)).data;
export const changeUser = async (email: string, change: { role?: UserRole; enabled?: boolean }) =>
  (await gateway.patch<CompanyUser>(`/v1/users/${encodeURIComponent(email)}`, change)).data;
export const removeUser = async (email: string) => (await gateway.delete(`/v1/users/${encodeURIComponent(email)}`)).data;
export const resendInvite = async (email: string) => (await gateway.post(`/v1/users/${encodeURIComponent(email)}/resend`, {})).data;
/** Tell the gateway someone signed in (marks an invited person active). */
export const announceSignIn = async () => { try { await gateway.get('/v1/me'); } catch { /* not important */ } };

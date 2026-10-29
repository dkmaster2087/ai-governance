/** Where the website sends contact requests (the gateway's public endpoint). */
export const API_URL: string = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/** The dashboard, for "Sign in" links. */
export const DASHBOARD_URL: string = import.meta.env.VITE_DASHBOARD_URL || 'http://localhost:5174';

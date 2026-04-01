export const mockShadowAIData = {
  summary: {
    totalBypassAttempts: 47,
    uniqueUsers: 12,
    blockedEndpoints: ['api.openai.com', 'claude.ai', 'chat.openai.com'],
    riskScore: 68,
    trend: '+23%',
  },
  bypassAttempts: [
    { date: '03-24', attempts: 4 },
    { date: '03-25', attempts: 7 },
    { date: '03-26', attempts: 3 },
    { date: '03-27', attempts: 9 },
    { date: '03-28', attempts: 6 },
    { date: '03-29', attempts: 11 },
    { date: '03-30', attempts: 7 },
  ],
  topBypassUsers: [
    { userId: 'user_sarah_k', department: 'Marketing', attempts: 14, lastSeen: '2026-03-30T14:22:00Z', endpoints: ['chat.openai.com', 'claude.ai'] },
    { userId: 'user_james_t', department: 'Engineering', attempts: 9, lastSeen: '2026-03-30T11:05:00Z', endpoints: ['api.openai.com'] },
    { userId: 'user_priya_m', department: 'Sales', attempts: 8, lastSeen: '2026-03-29T16:40:00Z', endpoints: ['chat.openai.com'] },
    { userId: 'user_carlos_r', department: 'Finance', attempts: 6, lastSeen: '2026-03-28T09:15:00Z', endpoints: ['claude.ai', 'gemini.google.com'] },
    { userId: 'user_lisa_w', department: 'HR', attempts: 5, lastSeen: '2026-03-27T13:30:00Z', endpoints: ['chat.openai.com'] },
  ],
  endpointBreakdown: [
    { endpoint: 'chat.openai.com', attempts: 22, percentage: 47 },
    { endpoint: 'claude.ai', attempts: 13, percentage: 28 },
    { endpoint: 'api.openai.com', attempts: 7, percentage: 15 },
    { endpoint: 'gemini.google.com', attempts: 5, percentage: 10 },
  ],
  recentEvents: [
    { id: 'evt_1', userId: 'user_sarah_k', endpoint: 'chat.openai.com', method: 'DNS_BYPASS', timestamp: '2026-03-30T14:22:00Z', blocked: true },
    { id: 'evt_2', userId: 'user_james_t', endpoint: 'api.openai.com', method: 'DIRECT_API', timestamp: '2026-03-30T11:05:00Z', blocked: true },
    { id: 'evt_3', userId: 'user_priya_m', endpoint: 'chat.openai.com', method: 'BROWSER', timestamp: '2026-03-30T09:30:00Z', blocked: false },
    { id: 'evt_4', userId: 'user_sarah_k', endpoint: 'claude.ai', method: 'BROWSER', timestamp: '2026-03-29T17:15:00Z', blocked: true },
    { id: 'evt_5', userId: 'user_carlos_r', endpoint: 'gemini.google.com', method: 'BROWSER', timestamp: '2026-03-29T16:40:00Z', blocked: false },
    { id: 'evt_6', userId: 'user_lisa_w', endpoint: 'chat.openai.com', method: 'DNS_BYPASS', timestamp: '2026-03-28T13:30:00Z', blocked: true },
  ],
};

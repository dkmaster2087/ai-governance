import axios from 'axios';

const scannerApi = axios.create({
  baseURL: '/scanner',
  timeout: 600_000, // 10 min timeout for large files
});

function getTenantId(): string {
  try {
    const stored = localStorage.getItem('aegis_auth_user');
    if (stored) return JSON.parse(stored).tenantId || 'tenant_demo';
  } catch {}
  return 'tenant_demo';
}

export async function scanFiles(files: File[], onProgress?: (pct: number) => void) {
  const form = new FormData();
  files.forEach((f) => form.append('files', f));

  const { data } = await scannerApi.post('/v1/scan/upload', form, {
    headers: {
      'x-tenant-id': getTenantId(),
      'x-user-id': 'admin',
    },
    onUploadProgress: (e) => {
      if (onProgress && e.total) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    },
  });
  return data;
}

export async function scanText(text: string) {
  const { data } = await scannerApi.post(
    '/v1/scan/text',
    { text, requestId: crypto.randomUUID() },
    { headers: { 'x-tenant-id': getTenantId() } }
  );
  return data;
}

import axios from 'axios';

const scannerApi = axios.create({ baseURL: '/scanner' });
const TENANT_ID = 'tenant_demo';

export async function scanFiles(files: File[]) {
  const form = new FormData();
  files.forEach((f) => form.append('files', f));

  const { data } = await scannerApi.post('/v1/scan/upload', form, {
    headers: {
      'x-tenant-id': TENANT_ID,
      'x-user-id': 'admin',
    },
  });
  return data;
}

export async function scanText(text: string) {
  const { data } = await scannerApi.post(
    '/v1/scan/text',
    { text, requestId: crypto.randomUUID() },
    { headers: { 'x-tenant-id': TENANT_ID } }
  );
  return data;
}

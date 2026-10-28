import axios, { AxiosInstance } from 'axios';

type HeaderProvider = () => Promise<Record<string, string>>;

let authHeaderProvider: HeaderProvider = async () => ({});

/** Registered by the auth module: returns the headers that identify the signed-in user. */
export function setAuthHeaderProvider(provider: HeaderProvider) {
  authHeaderProvider = provider;
}

export function getAuthHeaders(): Promise<Record<string, string>> {
  return authHeaderProvider();
}

/** Fired when the backend rejects our credentials, so the app can send the user back to sign-in. */
export const UNAUTHORIZED_EVENT = 'aegis:unauthorized';

/**
 * An axios client that attaches the signed-in user's credentials to every request.
 * A request may still set x-tenant-id itself (platform admins acting on another tenant).
 */
export function createApiClient(baseURL: string): AxiosInstance {
  const client = axios.create({ baseURL });
  client.interceptors.request.use(async (config) => {
    const auth = await getAuthHeaders();
    for (const [name, value] of Object.entries(auth)) {
      if (name === 'x-tenant-id' && config.headers.has('x-tenant-id')) continue;
      config.headers.set(name, value);
    }
    return config;
  });
  client.interceptors.response.use(undefined, (error) => {
    if (error?.response?.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    return Promise.reject(error);
  });
  return client;
}

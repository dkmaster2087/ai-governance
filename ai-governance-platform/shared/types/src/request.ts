export interface GatewayRequest {
  requestId: string;
  tenantId: string;
  userId: string;
  appId: string;
  timestamp: string;
}

export interface PaginationParams {
  limit?: number;
  nextToken?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  nextToken?: string;
  total?: number;
}

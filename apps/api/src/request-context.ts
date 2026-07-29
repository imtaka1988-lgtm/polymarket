import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export type ApiRequest = Request & { requestId: string };

export function requestContext(request: Request, response: Response, next: NextFunction): void {
  const candidate = request.header('x-request-id');
  const requestId =
    candidate !== undefined && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
  (request as ApiRequest).requestId = requestId;
  response.setHeader('x-request-id', requestId);
  next();
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

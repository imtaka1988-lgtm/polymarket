import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { API_VERSION } from './api-contract';
import type { ApiRequest } from './request-context';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<ApiRequest>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const problem = readProblem(exception, status);

    if (!(exception instanceof HttpException)) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'api_request_failed',
          requestId: request.requestId,
          method: request.method,
          path: request.originalUrl,
          message: exception instanceof Error ? exception.message : String(exception),
          timestamp: new Date().toISOString(),
        }),
      );
    }

    response.status(status).json({
      error: problem,
      meta: {
        apiVersion: API_VERSION,
        requestId: request.requestId,
        generatedAt: new Date().toISOString(),
      },
    });
  }
}

function readProblem(exception: unknown, status: number): { code: string; message: string } {
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    if (
      typeof response === 'object' &&
      response !== null &&
      'code' in response &&
      typeof response.code === 'string' &&
      'message' in response &&
      typeof response.message === 'string'
    ) {
      return { code: response.code, message: response.message };
    }
  }
  if (status === HttpStatus.NOT_FOUND) {
    return { code: 'ROUTE_NOT_FOUND', message: 'route was not found' };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'the request could not be completed',
  };
}

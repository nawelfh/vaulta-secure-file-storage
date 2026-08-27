import { ZodError } from 'zod';
import { ApiError } from '../utils/api-error.js';

export function notFound(request, response, next) {
  next(new ApiError(404, 'ROUTE_NOT_FOUND', 'The requested endpoint does not exist.'));
}

export function errorHandler(error, request, response, next) {
  if (response.headersSent) return next(error);

  if (error instanceof ZodError) {
    return response.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request data is invalid.',
        details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        requestId: request.id,
      },
    });
  }

  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return response.status(400).json({
      error: { code: 'INVALID_JSON', message: 'The request body is not valid JSON.', requestId: request.id },
    });
  }

  if (error.status === 413) {
    return response.status(413).json({
      error: { code: 'REQUEST_TOO_LARGE', message: 'The request body is too large.', requestId: request.id },
    });
  }

  const status = error instanceof ApiError ? error.status : 500;
  if (status >= 500) request.log?.error({ err: error }, 'Unhandled request error');
  return response.status(status).json({
    error: {
      code: error instanceof ApiError ? error.code : 'INTERNAL_ERROR',
      message: error instanceof ApiError ? error.message : 'An unexpected error occurred.',
      ...(error instanceof ApiError && error.details && { details: error.details }),
      requestId: request.id,
    },
  });
}

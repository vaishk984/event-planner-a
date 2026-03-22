/**
 * Error Handler Middleware
 * 
 * Global error handling and response formatting.
 * Similar to Spring's @ControllerAdvice / @ExceptionHandler.
 */

import { NextRequest, NextResponse } from 'next/server';
import { AppException } from '../exceptions';
import { createLogger, exceptionResponse, errorResponse, type ApiResponseData } from '../utils';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

const logger = createLogger('ErrorHandler');

/**
 * Wrap a route handler with error handling and rate limiting.
 * All API routes using this wrapper get automatic rate limiting (60 req/min per IP).
 */
export function withErrorHandler<T>(
    handler: (
        request: NextRequest,
        context: { params: Record<string, string> }
    ) => Promise<NextResponse<T>>
) {
    return async (
        request: NextRequest,
        context: { params: Record<string, string> }
    ): Promise<NextResponse<T | ApiResponseData<never>>> => {
        try {
            // Rate limit: 60 requests per minute per IP for standard API routes
            const ip = getClientIp(request);
            const rateLimitResult = checkRateLimit(ip, RATE_LIMITS.api);
            if (!rateLimitResult.success) {
                const response = errorResponse(
                    `Rate limit exceeded. Try again in ${rateLimitResult.retryAfterSeconds} seconds.`,
                    'RATE_LIMITED',
                    429
                );
                response.headers.set('Retry-After', String(rateLimitResult.retryAfterSeconds));
                return response;
            }

            return await handler(request, context);
        } catch (error) {
            return handleError(error, request);
        }
    };
}

/**
 * Handle error and return appropriate response
 */
export function handleError(
    error: unknown,
    request?: NextRequest
): NextResponse<ApiResponseData<never>> {
    // Log error details
    const requestInfo = request ? {
        method: request.method,
        url: request.url,
        userAgent: request.headers.get('user-agent'),
    } : {};

    if (error instanceof AppException) {
        // Known application error
        logger.warn(error.message, {
            ...requestInfo,
            code: error.code,
            statusCode: error.statusCode,
            details: error.details,
        });
        return exceptionResponse(error);
    }

    // Unknown error - log full details
    if (error instanceof Error) {
        logger.error('Unhandled error', error, requestInfo);

        // In production, don't expose internal error details
        const message = process.env.NODE_ENV === 'production'
            ? 'An internal server error occurred'
            : error.message;

        return errorResponse(message, 'INTERNAL_ERROR', 500);
    }

    // Completely unknown error type
    logger.error('Unknown error type', undefined, { error, ...requestInfo });
    return errorResponse('An unexpected error occurred', 'UNKNOWN_ERROR', 500);
}

/**
 * Safe JSON parse with error handling
 */
export async function safeJsonParse<T>(
    request: NextRequest,
    defaultValue?: T
): Promise<T | undefined> {
    try {
        return await request.json();
    } catch (err) {
        console.error('Failed to parse request JSON body:', err);
        return defaultValue;
    }
}

/**
 * Create an async handler with built-in error handling
 */
export function asyncHandler<T>(
    fn: (request: NextRequest, context: { params: Record<string, string> }) => Promise<NextResponse<T>>
) {
    return withErrorHandler(fn);
}

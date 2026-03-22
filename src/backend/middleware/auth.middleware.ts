/**
 * Authentication Middleware
 * 
 * Handles JWT verification and user authentication.
 * Similar to Spring Security's AuthenticationFilter.
 */

import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { UnauthorizedException, ForbiddenException } from '../exceptions';
import { AuthConfig, DatabaseConfig } from '../config';
import { User, UserRole } from '../entities';
import { createLogger } from '../utils';

const logger = createLogger('AuthMiddleware');

export interface AuthenticatedUser {
    id: string;
    email: string;
    role: UserRole;
    name?: string;
}

export interface AuthContext {
    user: AuthenticatedUser;
    isAuthenticated: true;
}

/**
 * Extract and validate authentication from request
 */
export async function authenticate(request: NextRequest): Promise<AuthContext> {
    // Try to get token from Authorization header
    const authHeader = request.headers.get('Authorization');

    // @supabase/ssr stores tokens in chunked cookies named
    // sb-<project-ref>-auth-token.0, .1, etc. — reassemble them.
    let cookieToken: string | undefined;
    const allCookies = request.cookies.getAll();
    const authCookieChunks = allCookies
        .filter(c => c.name.match(/^sb-.*-auth-token/))
        .sort((a, b) => a.name.localeCompare(b.name));
    if (authCookieChunks.length > 0) {
        try {
            const reassembled = authCookieChunks.map(c => c.value).join('');
            const parsed = JSON.parse(reassembled);
            cookieToken = parsed.access_token;
        } catch {
            // Malformed cookie — ignore
        }
    }

    const token = authHeader?.replace('Bearer ', '') || cookieToken;

    if (!token) {
        logger.debug('No authentication token found');
        throw new UnauthorizedException('Authentication token is required');
    }

    try {
        // Verify with Supabase
        const supabase = createClient(
            DatabaseConfig.supabase.url,
            DatabaseConfig.supabase.anonKey
        );

        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            logger.warn('Invalid authentication token', { error: error?.message });
            throw new UnauthorizedException('Invalid or expired token');
        }

        // Get user role from metadata or profile
        const role = (user.user_metadata?.role || 'client') as UserRole;

        return {
            user: {
                id: user.id,
                email: user.email!,
                role,
                name: user.user_metadata?.name,
            },
            isAuthenticated: true,
        };
    } catch (error) {
        if (error instanceof UnauthorizedException) {
            throw error;
        }
        logger.error('Authentication error', error);
        throw new UnauthorizedException('Authentication failed');
    }
}

/**
 * Check if user has required role
 */
export function requireRole(user: AuthenticatedUser, ...allowedRoles: UserRole[]): void {
    if (!allowedRoles.includes(user.role)) {
        logger.warn('Access denied - insufficient role', {
            userRole: user.role,
            requiredRoles: allowedRoles
        });
        throw new ForbiddenException('access this resource');
    }
}

/**
 * Check if user has required permission
 */
export function requirePermission(user: AuthenticatedUser, permission: string): void {
    const userEntity = new User({
        id: user.id,
        email: user.email,
        name: user.name || user.email,
        role: user.role,
        isActive: true,
    });

    if (!userEntity.hasPermission(permission)) {
        logger.warn('Access denied - insufficient permission', {
            userId: user.id,
            requiredPermission: permission
        });
        throw new ForbiddenException(permission.replace(':', ' '));
    }
}

/**
 * Optional authentication - returns null if not authenticated
 */
export async function optionalAuthenticate(request: NextRequest): Promise<AuthContext | null> {
    try {
        return await authenticate(request);
    } catch (err) {
        console.error('Optional authentication failed:', err);
        return null;
    }
}

/**
 * Wrapper for protected route handlers
 */
export function withAuth<TResult>(
    handler: (
        request: NextRequest,
        context: { params: Record<string, string>; auth: AuthContext }
    ) => Promise<TResult>,
    options: { roles?: UserRole[]; permission?: string } = {}
) {
    return async (
        request: NextRequest,
        context: { params: Record<string, string> }
    ): Promise<TResult> => {
        const auth = await authenticate(request);

        if (options.roles) {
            requireRole(auth.user, ...options.roles);
        }

        if (options.permission) {
            requirePermission(auth.user, options.permission);
        }

        return handler(request, { ...context, auth });
    };
}

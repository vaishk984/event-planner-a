import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the config before importing
vi.mock('@/src/backend/config', () => ({
    AppConfig: {
        api: {
            rateLimit: { windowMs: 60000, max: 100 }
        }
    },
    DatabaseConfig: {
        supabase: { url: 'http://test', anonKey: 'test' }
    },
    AuthConfig: {}
}))

import { checkRateLimit, RateLimitExceededException } from '@/src/backend/middleware/rate-limit.middleware'

function createMockRequest(ip: string = '127.0.0.1'): any {
    return {
        headers: {
            get: (name: string) => {
                if (name === 'x-forwarded-for') return ip
                return null
            }
        }
    }
}

describe('Rate Limiter', () => {
    it('allows requests under the limit', () => {
        const req = createMockRequest('10.0.0.1')
        expect(() => checkRateLimit(req, { max: 10, windowMs: 60000 })).not.toThrow()
    })

    it('blocks requests over the limit', () => {
        const req = createMockRequest('10.0.0.2')
        const opts = { max: 3, windowMs: 60000 }

        // First 3 should pass
        checkRateLimit(req, opts)
        checkRateLimit(req, opts)
        checkRateLimit(req, opts)

        // 4th should fail
        expect(() => checkRateLimit(req, opts)).toThrow(RateLimitExceededException)
    })
})

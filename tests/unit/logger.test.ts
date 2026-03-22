import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createLogger } from '@/lib/logger'

describe('Logger', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    it('creates a logger with context', () => {
        const logger = createLogger('TestContext')
        expect(logger).toBeDefined()
    })

    it('logs info messages', () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
        const logger = createLogger('Test')
        logger.info('test message')
        expect(spy).toHaveBeenCalled()
    })

    it('logs error messages with error details', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const logger = createLogger('Test')
        logger.error('something failed', new Error('test error'))
        expect(spy).toHaveBeenCalled()
    })

    it('logs with metadata', () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
        const logger = createLogger('Test')
        logger.info('with meta', { userId: '123', action: 'login' })
        expect(spy).toHaveBeenCalled()
    })

    it('logs warnings', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const logger = createLogger('Test')
        logger.warn('something suspicious')
        expect(spy).toHaveBeenCalled()
    })
})

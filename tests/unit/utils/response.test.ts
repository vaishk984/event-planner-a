import { describe, it, expect } from 'vitest'
import { ApiResponse, successResponse, errorResponse, createdResponse, paginatedResponse } from '@/src/backend/utils/response'

describe('ApiResponse', () => {
    describe('success', () => {
        it('returns 200 with data', async () => {
            const res = ApiResponse.success({ id: '1', name: 'Test' })
            expect(res.status).toBe(200)
            const body = await res.json()
            expect(body.success).toBe(true)
            expect(body.data).toEqual({ id: '1', name: 'Test' })
        })

        it('includes optional message', async () => {
            const res = ApiResponse.success('ok', 'Operation completed')
            const body = await res.json()
            expect(body.message).toBe('Operation completed')
        })
    })

    describe('created', () => {
        it('returns 201 with data', async () => {
            const res = ApiResponse.created({ id: 'new-1' })
            expect(res.status).toBe(201)
            const body = await res.json()
            expect(body.success).toBe(true)
            expect(body.data).toEqual({ id: 'new-1' })
            expect(body.message).toBe('Created successfully')
        })

        it('accepts custom message', async () => {
            const res = ApiResponse.created({ id: 'new-1' }, 'Event created')
            const body = await res.json()
            expect(body.message).toBe('Event created')
        })
    })

    describe('deleted', () => {
        it('returns 200 with deleted confirmation', async () => {
            const res = ApiResponse.deleted('del-1')
            expect(res.status).toBe(200)
            const body = await res.json()
            expect(body.success).toBe(true)
            expect(body.data.deleted).toBe(true)
            expect(body.data.id).toBe('del-1')
        })
    })

    describe('paginated', () => {
        it('returns paginated data with meta', async () => {
            const items = [{ id: '1' }, { id: '2' }]
            const meta = { page: 1, limit: 10, total: 25, totalPages: 3 }
            const res = ApiResponse.paginated(items, meta)
            expect(res.status).toBe(200)
            const body = await res.json()
            expect(body.success).toBe(true)
            expect(body.data.items).toHaveLength(2)
            expect(body.data.meta.total).toBe(25)
            expect(body.data.meta.totalPages).toBe(3)
        })
    })

    describe('error', () => {
        it('returns error response with status', async () => {
            const res = ApiResponse.error('Not found', 'NOT_FOUND', 404)
            expect(res.status).toBe(404)
            const body = await res.json()
            expect(body.success).toBe(false)
            expect(body.error.code).toBe('NOT_FOUND')
            expect(body.error.message).toBe('Not found')
        })

        it('defaults to 500 status', async () => {
            const res = ApiResponse.error('Server error')
            expect(res.status).toBe(500)
        })

        it('includes error details', async () => {
            const res = ApiResponse.error('Validation failed', 'VALIDATION', 422, { field: 'name' })
            const body = await res.json()
            expect(body.error.details).toEqual({ field: 'name' })
        })
    })

    describe('fromException', () => {
        it('handles generic Error', async () => {
            const res = ApiResponse.fromException(new Error('oops'))
            expect(res.status).toBe(500)
            const body = await res.json()
            expect(body.success).toBe(false)
            expect(body.error.message).toBe('oops')
        })

        it('handles non-Error values', async () => {
            const res = ApiResponse.fromException('string error')
            expect(res.status).toBe(500)
            const body = await res.json()
            expect(body.error.message).toBe('An unexpected error occurred')
        })
    })
})

describe('Legacy Response Functions', () => {
    it('successResponse returns 200', async () => {
        const res = successResponse({ ok: true })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.success).toBe(true)
    })

    it('createdResponse returns 201', async () => {
        const res = createdResponse({ id: '1' })
        expect(res.status).toBe(201)
    })

    it('errorResponse returns error with status', async () => {
        const res = errorResponse('Bad request', 'BAD_REQUEST', 400)
        expect(res.status).toBe(400)
        const body = await res.json()
        expect(body.success).toBe(false)
    })

    it('paginatedResponse includes pagination meta', async () => {
        const res = paginatedResponse([1, 2, 3], 1, 10, 50)
        const body = await res.json()
        expect(body.meta.page).toBe(1)
        expect(body.meta.totalPages).toBe(5)
    })
})

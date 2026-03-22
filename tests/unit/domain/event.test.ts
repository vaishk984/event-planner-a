import { describe, it, expect } from 'vitest'
import { Event, EventData } from '@/src/backend/entities/Event'

function createEventData(overrides: Partial<EventData> = {}): EventData {
    return {
        id: 'evt-001',
        plannerId: 'planner-001',
        name: 'Test Wedding',
        type: 'wedding',
        status: 'draft',
        date: '2026-06-15T10:00:00Z',
        guestCount: 150,
        budgetMin: 50000,
        budgetMax: 80000,
        city: 'Mumbai',
        venueType: 'showroom',
        ...overrides,
    }
}

describe('Event Entity', () => {
    describe('Construction', () => {
        it('creates an event from valid data', () => {
            const event = new Event(createEventData())
            expect(event.id).toBe('evt-001')
            expect(event.name).toBe('Test Wedding')
            expect(event.type).toBe('wedding')
            expect(event.status).toBe('draft')
            expect(event.guestCount).toBe(150)
            expect(event.city).toBe('Mumbai')
        })

        it('parses date strings into Date objects', () => {
            const event = new Event(createEventData({ date: '2026-06-15T10:00:00Z' }))
            expect(event.date).toBeInstanceOf(Date)
            expect(event.date.toISOString()).toBe('2026-06-15T10:00:00.000Z')
        })

        it('handles optional endDate', () => {
            const withEnd = new Event(createEventData({ endDate: '2026-06-16T22:00:00Z' }))
            expect(withEnd.endDate).toBeInstanceOf(Date)

            const withoutEnd = new Event(createEventData())
            expect(withoutEnd.endDate).toBeUndefined()
        })

        it('handles optional fields', () => {
            const event = new Event(createEventData({ clientId: 'client-001', notes: 'VIP event' }))
            expect(event.clientId).toBe('client-001')
            expect(event.notes).toBe('VIP event')
        })
    })

    describe('Budget', () => {
        it('calculates budget average', () => {
            const event = new Event(createEventData({ budgetMin: 40000, budgetMax: 60000 }))
            expect(event.budget.min).toBe(40000)
            expect(event.budget.max).toBe(60000)
            expect(event.budget.average).toBe(50000)
        })
    })

    describe('Status Transitions', () => {
        it('allows valid transition: draft -> planning', () => {
            const event = new Event(createEventData({ status: 'draft' }))
            expect(event.canTransitionTo('planning')).toBe(true)
            event.transitionTo('planning')
            expect(event.status).toBe('planning')
        })

        it('allows valid transition: planning -> proposed', () => {
            const event = new Event(createEventData({ status: 'planning' }))
            event.transitionTo('proposed')
            expect(event.status).toBe('proposed')
        })

        it('allows valid transition: proposed -> approved', () => {
            const event = new Event(createEventData({ status: 'proposed' }))
            event.transitionTo('approved')
            expect(event.status).toBe('approved')
        })

        it('allows valid transition: approved -> live', () => {
            const event = new Event(createEventData({ status: 'approved' }))
            event.transitionTo('live')
            expect(event.status).toBe('live')
        })

        it('allows valid transition: live -> completed', () => {
            const event = new Event(createEventData({ status: 'live' }))
            event.transitionTo('completed')
            expect(event.status).toBe('completed')
        })

        it('rejects invalid transition: draft -> approved', () => {
            const event = new Event(createEventData({ status: 'draft' }))
            expect(event.canTransitionTo('approved')).toBe(false)
            expect(() => event.transitionTo('approved')).toThrow('Cannot transition from draft to approved')
        })

        it('rejects invalid transition: completed -> draft', () => {
            const event = new Event(createEventData({ status: 'completed' }))
            expect(event.canTransitionTo('draft')).toBe(false)
        })

        it('does not allow transitions from archived', () => {
            const event = new Event(createEventData({ status: 'archived' }))
            expect(event.canTransitionTo('draft')).toBe(false)
            expect(event.canTransitionTo('planning')).toBe(false)
            expect(event.canTransitionTo('cancelled')).toBe(false)
        })

        it('allows cancellation from most active states', () => {
            for (const status of ['draft', 'planning', 'proposed', 'approved'] as const) {
                const event = new Event(createEventData({ status }))
                expect(event.canTransitionTo('cancelled')).toBe(true)
            }
        })
    })

    describe('Business Logic', () => {
        it('isEditable for draft and planning', () => {
            expect(new Event(createEventData({ status: 'draft' })).isEditable).toBe(true)
            expect(new Event(createEventData({ status: 'planning' })).isEditable).toBe(true)
            expect(new Event(createEventData({ status: 'approved' })).isEditable).toBe(false)
            expect(new Event(createEventData({ status: 'live' })).isEditable).toBe(false)
        })

        it('isLocked for approved, live, completed, archived', () => {
            expect(new Event(createEventData({ status: 'approved' })).isLocked).toBe(true)
            expect(new Event(createEventData({ status: 'live' })).isLocked).toBe(true)
            expect(new Event(createEventData({ status: 'completed' })).isLocked).toBe(true)
            expect(new Event(createEventData({ status: 'archived' })).isLocked).toBe(true)
            expect(new Event(createEventData({ status: 'draft' })).isLocked).toBe(false)
        })

        it('canSendProposal only when planning', () => {
            expect(new Event(createEventData({ status: 'planning' })).canSendProposal()).toBe(true)
            expect(new Event(createEventData({ status: 'draft' })).canSendProposal()).toBe(false)
            expect(new Event(createEventData({ status: 'proposed' })).canSendProposal()).toBe(false)
        })

        it('canApprove only when proposed', () => {
            expect(new Event(createEventData({ status: 'proposed' })).canApprove()).toBe(true)
            expect(new Event(createEventData({ status: 'planning' })).canApprove()).toBe(false)
            expect(new Event(createEventData({ status: 'approved' })).canApprove()).toBe(false)
        })
    })

    describe('Serialization', () => {
        it('toJSON returns plain data object', () => {
            const event = new Event(createEventData())
            const json = event.toJSON()
            expect(json.id).toBe('evt-001')
            expect(json.name).toBe('Test Wedding')
            expect(json.status).toBe('draft')
            expect(typeof json.date).toBe('string')
            expect(typeof json.createdAt).toBe('string')
        })

        it('fromDatabase creates event from DB row', () => {
            const row = {
                id: 'db-001',
                planner_id: 'planner-001',
                client_id: 'client-001',
                name: 'DB Event',
                type: 'corporate',
                status: 'planning',
                date: '2026-07-01T09:00:00Z',
                end_date: '2026-07-01T18:00:00Z',
                guest_count: 200,
                budget_min: 100000,
                budget_max: 150000,
                city: 'Delhi',
                venue_type: 'showroom',
                venue_id: 'venue-001',
                notes: 'Annual summit',
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-15T00:00:00Z',
            }
            const event = Event.fromDatabase(row)
            expect(event.id).toBe('db-001')
            expect(event.plannerId).toBe('planner-001')
            expect(event.clientId).toBe('client-001')
            expect(event.name).toBe('DB Event')
            expect(event.type).toBe('corporate')
            expect(event.status).toBe('planning')
            expect(event.guestCount).toBe(200)
            expect(event.city).toBe('Delhi')
        })
    })
})

/**
 * Event Actions (Server Actions)
 * 
 * Server-side actions for event operations.
 * These are the entry points for UI components.
 * 
 * Based on: docs/ARCHITECTURE.md (Section 3.2)
 */

'use server'

import { eventService } from '@/lib/services/event-service';
import type { Event, EventStatus, ActionResult } from '@/types/domain';
import { revalidatePath } from 'next/cache';
import { getUserId } from '@/lib/session';
import { supabaseIntakeRepository } from '@/lib/repositories/supabase-intake-repository';
import { createInitialInvoiceForEvent } from '@/actions/invoices-tasks';

async function getPlannerId(): Promise<string | null> {
    return getUserId();
}

// ============================================
// QUERY ACTIONS
// ============================================

/**
 * Get all events
 */
export async function getEvents(): Promise<Event[]> {
    const plannerId = await getPlannerId();
    if (!plannerId) {
        return [];
    }

    return eventService.getEvents(plannerId);
}

/**
 * Get event by ID
 */
export async function getEvent(id: string): Promise<Event | null> {
    const plannerId = await getPlannerId();
    if (!plannerId) {
        return null;
    }

    const event = await eventService.getEvent(id, plannerId);
    if (!event) {
        return null;
    }

    const intake = event.submissionId
        ? await supabaseIntakeRepository.findById(event.submissionId)
        : await supabaseIntakeRepository.findByConvertedEventId(event.id);

    if (!intake) {
        return event;
    }

    const combinedNotes = [
        event.notes,
        intake.specialRequests,
        intake.food?.specialRequests,
        intake.decor?.specialRequests,
        intake.entertainment?.specialRequests,
        intake.photography?.specialRequests,
        intake.services?.specialRequests,
    ]
        .filter((value): value is string => Boolean(value && value.trim()))
        .join('\n\n');

    return {
        ...event,
        city: event.city || intake.city || '',
        venueName: event.venueName || intake.personalVenue?.name || undefined,
        venueAddress: event.venueAddress || intake.personalVenue?.address || undefined,
        notes: combinedNotes || undefined,
        requirements: {
            personalVenue: intake.personalVenue,
            food: intake.food,
            decor: intake.decor,
            entertainment: intake.entertainment,
            photography: intake.photography,
            services: intake.services,
            likedVendors: intake.likedVendors,
            specialRequests: intake.specialRequests,
        },
    } as Event;
}

/**
 * Get events by status
 */
export async function getEventsByStatus(status: EventStatus): Promise<Event[]> {
    const plannerId = await getPlannerId();
    if (!plannerId) {
        return [];
    }

    return eventService.getEventsByStatus(status, plannerId);
}

/**
 * Get upcoming events
 */
export async function getUpcomingEvents(): Promise<Event[]> {
    const plannerId = await getPlannerId();
    if (!plannerId) {
        return [];
    }

    return eventService.getUpcomingEvents(plannerId);
}

/**
 * Get today's events
 */
export async function getTodayEvents(): Promise<Event[]> {
    const plannerId = await getPlannerId();
    if (!plannerId) {
        return [];
    }

    return eventService.getTodayEvents(plannerId);
}

/**
 * Get dashboard statistics
 */
export async function getDashboardStats() {
    const plannerId = await getPlannerId();
    if (!plannerId) {
        return {
            total: 0,
            byStatus: {
                submission: 0,
                draft: 0,
                planning: 0,
                proposed: 0,
                approved: 0,
                live: 0,
                completed: 0,
                archived: 0,
            },
            upcomingCount: 0,
            todayCount: 0,
        };
    }

    return eventService.getDashboardStats(plannerId);
}

// ============================================
// MUTATION ACTIONS
// ============================================

/**
 * Convert submission to event
 */
export async function convertSubmissionToEvent(
    submissionId: string,
): Promise<ActionResult<Event>> {
    const plannerId = await getPlannerId();
    if (!plannerId) {
        return { success: false, error: 'Not authenticated', code: 'UNAUTHORIZED' };
    }

    const result = await eventService.convertSubmissionToEvent(submissionId, plannerId);

    if (result.success) {
        if (result.data) {
            await createInitialInvoiceForEvent({
                eventId: result.data.id,
                eventName: result.data.name,
                clientName: result.data.clientName,
                clientEmail: result.data.clientEmail,
                clientPhone: result.data.clientPhone,
                budgetMax: result.data.budgetMax,
                eventDate: result.data.date,
            });
        }
        revalidatePath('/planner/events');
        revalidatePath('/planner');
        revalidatePath('/planner/invoices');
    }

    return result;
}

/**
 * Create new event
 */
export async function createEvent(
    data: Partial<Event>,
): Promise<ActionResult<Event>> {
    const plannerId = await getPlannerId();
    if (!plannerId) {
        return { success: false, error: 'Not authenticated', code: 'UNAUTHORIZED' };
    }

    const result = await eventService.createEvent(data, plannerId);

    if (result.success) {
        if (result.data) {
            await createInitialInvoiceForEvent({
                eventId: result.data.id,
                eventName: result.data.name,
                clientName: result.data.clientName,
                clientEmail: result.data.clientEmail,
                clientPhone: result.data.clientPhone,
                budgetMax: result.data.budgetMax,
                eventDate: result.data.date,
            });
        }
        revalidatePath('/planner/events');
        revalidatePath('/planner');
        revalidatePath('/planner/invoices');
    }

    return result;
}

/**
 * Update event
 */
export async function updateEvent(
    id: string,
    data: Partial<Event>
): Promise<ActionResult<Event>> {
    const plannerId = await getPlannerId();
    if (!plannerId) {
        return { success: false, error: 'Not authenticated', code: 'UNAUTHORIZED' };
    }

    const result = await eventService.updateEvent(id, data, plannerId);

    if (result.success) {
        revalidatePath(`/planner/events/${id}`);
        revalidatePath('/planner/events');
    }

    return result;
}

/**
 * Update event status
 */
export async function updateEventStatus(
    id: string,
    status: EventStatus
): Promise<ActionResult<Event>> {
    const plannerId = await getPlannerId();
    if (!plannerId) {
        return { success: false, error: 'Not authenticated', code: 'UNAUTHORIZED' };
    }

    const result = await eventService.updateEventStatus(id, status, plannerId);

    if (result.success) {
        revalidatePath(`/planner/events/${id}`);
        revalidatePath('/planner/events');
        revalidatePath('/planner');
    }

    return result;
}

/**
 * Send proposal to client
 */
export async function sendProposal(eventId: string): Promise<ActionResult<Event>> {
    const plannerId = await getPlannerId();
    if (!plannerId) {
        return { success: false, error: 'Not authenticated', code: 'UNAUTHORIZED' };
    }

    const result = await eventService.sendProposal(eventId, plannerId);

    if (result.success) {
        revalidatePath(`/planner/events/${eventId}`);
    }

    return result;
}

/**
 * Approve event (client action)
 */
export async function approveEvent(eventId: string): Promise<ActionResult<Event>> {
    const plannerId = await getPlannerId();
    if (!plannerId) {
        return { success: false, error: 'Not authenticated', code: 'UNAUTHORIZED' };
    }

    const result = await eventService.approveEvent(eventId, plannerId);

    if (result.success) {
        revalidatePath(`/planner/events/${eventId}`);
        revalidatePath('/planner/events');
    }

    return result;
}

/**
 * Archive event
 */
export async function archiveEvent(eventId: string): Promise<ActionResult<Event>> {
    const plannerId = await getPlannerId();
    if (!plannerId) {
        return { success: false, error: 'Not authenticated', code: 'UNAUTHORIZED' };
    }

    const result = await eventService.archiveEvent(eventId, plannerId);

    if (result.success) {
        revalidatePath('/planner/events');
    }

    return result;
}

/**
 * Delete event
 */
export async function deleteEvent(id: string): Promise<ActionResult<void>> {
    const plannerId = await getPlannerId();
    if (!plannerId) {
        return { success: false, error: 'Not authenticated', code: 'UNAUTHORIZED' };
    }

    const result = await eventService.deleteEvent(id, plannerId);

    if (result.success) {
        revalidatePath('/planner/events');
    }

    return result;
}

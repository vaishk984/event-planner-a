'use server'
import { getSession } from '@/lib/session';
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

interface BookingWithVendor {
    id: string
    service: string | null
    status: string
    budget: number | null
    quoted_amount: number | null
    notes: string | null
    vendors: { business_name?: string; rating?: number; category?: string } | { business_name?: string; rating?: number; category?: string }[] | null
}

// ============================================================================
// TOKEN VALIDATION
// ============================================================================

/**
 * Validate a client portal token and return the event
 */
export async function getEventByClientToken(token: string) {
    const supabase = await createClient()

    const { data: event, error } = await supabase
        .from('events')
        .select(`
            id, name, date, end_date, venue_name, venue_address, type,
            status, guest_count, budget_max,
            client_name, client_email, client_phone,
            planner_id
        `)
        .eq('client_token', token)
        .single()

    if (error || !event) {
        return { error: 'Invalid or expired link' }
    }

    return { data: event }
}

// ============================================================================
// ANONYMIZED EVENT DATA FOR CLIENT
// ============================================================================

/**
 * Get service categories with status (no vendor names)
 */
export async function getClientServices(token: string) {
    const supabase = await createClient()

    // Validate token
    const { data: event, error } = await supabase
        .from('events')
        .select('id')
        .eq('client_token', token)
        .single()

    if (error || !event) return { error: 'Invalid link', data: [] }

    // Get booking requests without vendor info
    const { data: bookings } = await supabase
        .from('booking_requests')
        .select('id, service, status, budget, quoted_amount')
        .eq('event_id', event.id)
        .neq('status', 'declined')

    // Map to anonymized service categories
    const serviceLabels: Record<string, string> = {
        'catering': 'Culinary Experience',
        'photography': 'Memory Capture',
        'videography': 'Film & Highlights',
        'decor': 'Ambience Design',
        'decoration': 'Ambience Design',
        'venue': 'Venue & Spaces',
        'entertainment': 'Entertainment',
        'music': 'Music & DJ',
        'dj': 'Music & DJ',
        'makeup': 'Styling & Beauty',
        'mehendi': 'Mehendi Art',
        'transport': 'Transport & Logistics',
        'invitation': 'Invitations & Stationery',
        'lighting': 'Lighting Design',
        'florist': 'Floral Design',
        'cake': 'Cake & Desserts',
    }

    const services = (bookings || []).map(b => ({
        id: b.id,
        category: serviceLabels[(b.service || '').toLowerCase()] || 'Event Service',
        status: b.status === 'accepted' || b.status === 'confirmed' ? 'confirmed' :
            b.status === 'pending' ? 'in_progress' : 'pending',
        statusLabel: b.status === 'accepted' || b.status === 'confirmed' ? '✅ Confirmed' :
            b.status === 'pending' ? '🔄 In Progress' : '⏳ Pending',
    }))

    return { data: services }
}

// ============================================================================
// ANONYMIZED D-DAY UPDATES
// ============================================================================

/**
 * Get D-day updates with all vendor info stripped
 */
export async function getClientUpdates(token: string) {
    const supabase = await createClient()

    const { data: event, error } = await supabase
        .from('events')
        .select('id')
        .eq('client_token', token)
        .single()

    if (error || !event) return { error: 'Invalid link', data: [] }

    const { data: updates } = await supabase
        .from('vendor_updates')
        .select('id, update_type, message, photo_url, status_tag, created_at')
        .eq('event_id', event.id)
        .order('created_at', { ascending: false })

    // Anonymize — replace any vendor-specific info
    const anonymized = (updates || []).map(u => ({
        id: u.id,
        type: u.update_type,
        message: u.message,
        photoUrl: u.photo_url,
        statusTag: u.status_tag,
        createdAt: u.created_at,
        sender: 'Your Planning Team',  // Always anonymized
    }))

    return { data: anonymized }
}

/**
 * Get anonymized arrival progress for D-day
 */
export async function getClientDayProgress(token: string) {
    const supabase = await createClient()

    const { data: event, error } = await supabase
        .from('events')
        .select('id')
        .eq('client_token', token)
        .single()

    if (error || !event) return { error: 'Invalid link', data: null }

    // Get arrival-type updates
    const { data: arrivals } = await supabase
        .from('vendor_updates')
        .select('vendor_id, status_tag')
        .eq('event_id', event.id)
        .in('status_tag', ['arrived', 'setup_complete', 'completed', 'departed'])

    // Get total vendor count
    const { data: bookings } = await supabase
        .from('booking_requests')
        .select('vendor_id')
        .eq('event_id', event.id)
        .in('status', ['accepted', 'confirmed'])

    const totalServices = bookings?.length || 0
    const arrivedVendors = new Set((arrivals || []).map(a => a.vendor_id)).size

    return {
        data: {
            totalServices,
            arrivedCount: arrivedVendors,
            progressPercent: totalServices > 0 ? Math.round((arrivedVendors / totalServices) * 100) : 0
        }
    }
}

// ============================================================================
// CLIENT MESSAGES
// ============================================================================

/**
 * Get messages for an event (client ↔ planner)
 */
export async function getClientMessages(token: string) {
    const supabase = await createClient()

    const { data: event, error } = await supabase
        .from('events')
        .select('id')
        .eq('client_token', token)
        .single()

    if (error || !event) return { error: 'Invalid link', data: [] }

    const { data: messages } = await supabase
        .from('client_messages')
        .select('*')
        .eq('event_id', event.id)
        .order('created_at', { ascending: true })

    return { data: messages || [] }
}

/**
 * Send a message from client
 */
export async function sendClientMessage(token: string, message: string) {
    const supabase = await createClient()

    const { data: event, error } = await supabase
        .from('events')
        .select('id')
        .eq('client_token', token)
        .single()

    if (error || !event) return { error: 'Invalid link' }

    const { error: insertError } = await supabase
        .from('client_messages')
        .insert({
            event_id: event.id,
            sender_type: 'client',
            message: message.trim(),
        })

    if (insertError) {
        console.error('Error sending message:', insertError)
        return { error: 'Failed to send message' }
    }

    return { success: true }
}

/**
 * Send a message from planner
 */
export async function sendPlannerMessage(eventId: string, message: string) {
    const supabase = await createClient()
    const session = await getSession();
    
    if (!session?.userId) return { error: 'Unauthorized' }

    const { error } = await supabase
        .from('client_messages')
        .insert({
            event_id: eventId,
            sender_type: 'planner',
            message: message.trim(),
        })

    if (error) {
        console.error('Error sending planner message:', error)
        return { error: 'Failed to send message' }
    }

    revalidatePath(`/planner/events/${eventId}`)
    return { success: true }
}

// ============================================================================
// GENERATE CLIENT TOKEN (Planner side)
// ============================================================================

/**
 * Generate or retrieve the client portal token for an event
 */
export async function getOrCreateClientToken(eventId: string) {
    const supabase = await createClient()
    const session = await getSession();
    
    if (!session?.userId) return { error: 'Unauthorized' }

    // First check if token already exists
    const { data: event } = await supabase
        .from('events')
        .select('client_token')
        .eq('id', eventId)
        .eq('planner_id', session?.userId)
        .single()

    if (!event) return { error: 'Event not found' }

    if (event.client_token) {
        return { token: event.client_token }
    }

    // Generate new token
    const { data: updated, error } = await supabase
        .from('events')
        .update({ client_token: crypto.randomUUID() })
        .eq('id', eventId)
        .eq('planner_id', session?.userId)
        .select('client_token')
        .single()

    if (error || !updated) {
        return { error: 'Failed to generate link' }
    }

    return { token: updated.client_token }
}

// ============================================================================
// SEND FINAL PROPOSAL (Frozen Snapshot)
// ============================================================================

/**
 * Generate a final proposal snapshot token for the event
 */
export async function sendFinalProposal(eventId: string) {
    const supabase = await createClient()
    const session = await getSession();
    
    if (!session?.userId) return { error: 'Unauthorized' }

    const finalToken = crypto.randomUUID()

    // Get current event context and version count
    const { data: event, error: eventError } = await supabase
        .from('events')
        .select('id, name, date, venue_name, venue_address, type, guest_count, proposal_version, client_token, planner_id')
        .eq('id', eventId)
        .eq('planner_id', session?.userId)
        .single()

    if (eventError || !event) {
        console.error('Error loading event for final proposal:', eventError)
        return { error: 'Event not found' }
    }

    const newVersion = ((event as { proposal_version?: number })?.proposal_version || 0) + 1

    const { data: planner } = await supabase
        .from('planner_profiles')
        .select('business_name, phone')
        .eq('user_id', event.planner_id)
        .single()

    const { data: bookings } = await supabase
        .from('booking_requests')
        .select(`
            id, service, status, budget, quoted_amount, notes,
            vendors:vendor_id (business_name, rating, category)
        `)
        .eq('event_id', eventId)
        .in('status', ['accepted', 'confirmed'])

    const { data: timeline } = await supabase
        .from('timeline_items')
        .select('*')
        .eq('event_id', eventId)
        .order('start_time', { ascending: true })

    const categoryIconMap: Record<string, string> = {
        'venue': 'Building2',
        'catering': 'UtensilsCrossed',
        'photography': 'Camera',
        'videography': 'Camera',
        'decor': 'Sparkles',
        'decoration': 'Sparkles',
        'music': 'Music',
        'dj': 'Music',
        'entertainment': 'Music',
        'makeup': 'Brush',
        'mehendi': 'Brush',
        'transport': 'Car',
    }

    const categories = ((bookings || []) as BookingWithVendor[]).map((b) => {
        const rawVendor = b.vendors
        const vendor = Array.isArray(rawVendor) ? rawVendor[0] || {} : rawVendor || {}
        const serviceKey = (b.service || '').toLowerCase()
        const isPerPlate = serviceKey === 'catering'
        return {
            id: b.id,
            name: b.service || 'Service',
            icon: categoryIconMap[serviceKey] || 'Sparkles',
            vendor: { name: vendor.business_name || 'Partner', rating: vendor.rating || 4.5 },
            price: b.quoted_amount || b.budget || 0,
            perPlatePrice: isPerPlate ? (b.quoted_amount || b.budget || 0) / ((event.guest_count || 1) as number) : null,
            guestCount: isPerPlate ? event.guest_count : null,
            items: b.notes ? b.notes.split(',').map((s: string) => s.trim()) : [],
            status: b.status,
        }
    })

    const timelineFormatted = (timeline || []).map((t: any) => ({
        id: t.id,
        time: t.start_time ? new Date(`2000-01-01T${t.start_time}`).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '',
        duration: t.duration ? `${t.duration} min` : null,
        title: t.title,
        description: t.description,
        category: t.category || 'general',
    }))

    const snapshotData = {
        eventName: event.name,
        date: event.date,
        guestCount: event.guest_count,
        city: event.venue_address || event.venue_name || '',
        plannerName: planner?.business_name || 'Your Planner',
        plannerPhone: planner?.phone || '',
        personalMessage: `Final proposal for your ${event.type || 'event'}.`,
        categories,
        timeline: timelineFormatted,
        status: 'sent',
        validUntil: 'Final Version',
        postApprovalNote: 'This is the final proposal. Upon approval, execution begins.',
    }

    const { error: snapshotInsertError } = await supabase
        .from('proposal_snapshots')
        .insert({
            event_id: eventId,
            version: newVersion,
            token: finalToken,
            status: 'sent',
            snapshot_data: snapshotData,
        })

    if (snapshotInsertError) {
        console.error('Error creating final proposal snapshot:', snapshotInsertError)
        return { error: 'Failed to create final snapshot' }
    }

    const updatePayload: Record<string, any> = {
        final_proposal_token: finalToken,
        proposal_status: 'final',
        proposal_version: newVersion,
    }

    // Older rows can have null client_token; public read policy depends on this column being present.
    const eventWithClientToken = event as { client_token?: string | null } | null
    if (!eventWithClientToken?.client_token) {
        updatePayload.client_token = crypto.randomUUID()
    }

    const { error } = await supabase
        .from('events')
        .update(updatePayload)
        .eq('id', eventId)
        .eq('planner_id', session?.userId)

    if (error) {
        console.error('Error sending final proposal:', error)
        return { error: 'Failed to send final proposal' }
    }

    revalidatePath('/planner/proposals')
    revalidatePath(`/planner/events/${eventId}/client`)
    return { success: true, token: finalToken, version: newVersion }
}

// ============================================================================
// PUBLIC PROPOSAL VIEWER (used by /proposal/[token])
// ============================================================================

/**
 * Get proposal details by public token (for draft/live proposals)
 */
export async function getPublicProposalDetails(token: string) {
    const supabase = await createClient()
    const cleanToken = token.startsWith('final_') ? token.slice(6) : token

    const { data: event, error } = await supabase
        .from('events')
        .select(`
            id, name, date, end_date, venue_name, venue_address, type,
            status, guest_count, budget_max, proposal_status,
            client_name, client_email, client_phone, client_feedback,
            planner_id
        `)
        .eq('public_token', token)
        .single()

    if (error || !event) {
        const { data: finalEvent } = await supabase
            .from('events')
            .select(`
                id, name, date, end_date, venue_name, venue_address, type,
                status, guest_count, budget_max, proposal_status,
                client_name, client_email, client_phone, client_feedback,
                planner_id
            `)
            .eq('final_proposal_token', cleanToken)
            .single()

        if (finalEvent) {
            const { data: planner } = await supabase
                .from('planner_profiles')
                .select('business_name, phone')
                .eq('user_id', finalEvent.planner_id)
                .single()

            const { data: bookings } = await supabase
                .from('booking_requests')
                .select(`
                    id, service, status, budget, quoted_amount, notes,
                    vendors:vendor_id (business_name, rating, category)
                `)
                .eq('event_id', finalEvent.id)
                .in('status', ['accepted', 'confirmed'])

            const { data: timeline } = await supabase
                .from('timeline_items')
                .select('*')
                .eq('event_id', finalEvent.id)
                .order('start_time', { ascending: true })

            const categoryIconMap: Record<string, string> = {
                'venue': 'Building2',
                'catering': 'UtensilsCrossed',
                'photography': 'Camera',
                'videography': 'Camera',
                'decor': 'Sparkles',
                'decoration': 'Sparkles',
                'music': 'Music',
                'dj': 'Music',
                'entertainment': 'Music',
                'makeup': 'Brush',
                'mehendi': 'Brush',
                'transport': 'Car',
            }

            const categories = ((bookings || []) as BookingWithVendor[]).map((b) => {
                const rawVendor = b.vendors
                const vendor = Array.isArray(rawVendor) ? rawVendor[0] || {} : rawVendor || {}
                const serviceKey = (b.service || '').toLowerCase()
                const isPerPlate = serviceKey === 'catering'
                return {
                    id: b.id,
                    name: b.service || 'Service',
                    icon: categoryIconMap[serviceKey] || 'Sparkles',
                    vendor: {
                        name: vendor.business_name || 'Partner',
                        rating: vendor.rating || 4.5,
                    },
                    price: b.quoted_amount || b.budget || 0,
                    perPlatePrice: isPerPlate ? (b.quoted_amount || b.budget || 0) / (finalEvent.guest_count || 1) : null,
                    guestCount: isPerPlate ? finalEvent.guest_count : null,
                    items: b.notes ? b.notes.split(',').map((s: string) => s.trim()) : [],
                    status: b.status,
                }
            })

            const timelineFormatted = (timeline || []).map(t => ({
                id: t.id,
                time: t.start_time ? new Date(`2000-01-01T${t.start_time}`).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '',
                duration: t.duration ? `${t.duration} min` : null,
                title: t.title,
                description: t.description,
                category: t.category || 'general',
            }))

            return {
                proposal: {
                    eventName: finalEvent.name,
                    date: finalEvent.date,
                    guestCount: finalEvent.guest_count,
                    city: finalEvent.venue_address || finalEvent.venue_name || '',
                    plannerName: planner?.business_name || 'Your Planner',
                    plannerPhone: planner?.phone || '',
                    personalMessage: `Final proposal for your ${finalEvent.type || 'event'}.`,
                    categories,
                    timeline: timelineFormatted,
                    status: finalEvent.proposal_status,
                    validUntil: 'Final Version',
                    postApprovalNote: 'This is the final proposal. Upon approval, execution begins.',
                },
                error: null,
            }
        }

        const { data: snapshot, error: snapshotError } = await supabase
            .from('proposal_snapshots')
            .select(`
                id,
                event_id,
                status,
                client_feedback,
                snapshot_data,
                created_at,
                events!inner(
                    id,
                    name,
                    date,
                    venue_name,
                    venue_address,
                    guest_count,
                    type,
                    proposal_status,
                    planner_id
                )
            `)
            .eq('token', token)
            .single()

        if (snapshotError || !snapshot) {
            return { error: 'Proposal not found or link has expired' }
        }

        const snapshotData = (snapshot.snapshot_data || {}) as Record<string, any>
        const snapshotEvent = Array.isArray(snapshot.events) ? snapshot.events[0] : snapshot.events

        let plannerName = 'Your Planner'
        let plannerPhone = ''
        if (snapshotEvent?.planner_id) {
            const { data: planner } = await supabase
                .from('planner_profiles')
                .select('business_name, phone')
                .eq('user_id', snapshotEvent.planner_id)
                .single()

            plannerName = planner?.business_name || plannerName
            plannerPhone = planner?.phone || plannerPhone
        }

        return {
            proposal: {
                eventName: (snapshotData.eventName as string) || snapshotEvent?.name || 'Your Event',
                date: (snapshotData.date as string) || snapshotEvent?.date || new Date(snapshot.created_at).toISOString(),
                guestCount: (snapshotData.guestCount as number) || snapshotEvent?.guest_count || 0,
                city: (snapshotData.city as string) || snapshotEvent?.venue_address || snapshotEvent?.venue_name || '',
                plannerName: (snapshotData.plannerName as string) || plannerName,
                plannerPhone,
                personalMessage: (snapshotData.personalMessage as string) || `We're thrilled to be part of your ${snapshotEvent?.type || 'event'}! Here's what we've curated for you.`,
                categories: Array.isArray(snapshotData.categories) ? snapshotData.categories : [],
                timeline: Array.isArray(snapshotData.timeline) ? snapshotData.timeline : [],
                status: snapshot.status || snapshotEvent?.proposal_status || 'sent',
                validUntil: (snapshotData.validUntil as string) || new Date(snapshot.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
                postApprovalNote: (snapshotData.postApprovalNote as string) || 'Once approved, we will finalize all vendor bookings, confirm the timeline, and send you a detailed event day runsheet.',
            },
            error: null,
        }
    }

    // Get planner info
    const { data: planner } = await supabase
        .from('planner_profiles')
        .select('business_name, phone')
        .eq('user_id', event.planner_id)
        .single()

    // Get booking requests with vendor info for proposal display
    const { data: bookings } = await supabase
        .from('booking_requests')
        .select(`
            id, service, status, budget, quoted_amount, notes,
            vendors:vendor_id (business_name, rating, category)
        `)
        .eq('event_id', event.id)
        .in('status', ['accepted', 'confirmed', 'pending'])

    // Get timeline items
    const { data: timeline } = await supabase
        .from('timeline_items')
        .select('*')
        .eq('event_id', event.id)
        .order('start_time', { ascending: true })

    // Build proposal object
    const categoryIconMap: Record<string, string> = {
        'venue': 'Building2',
        'catering': 'UtensilsCrossed',
        'photography': 'Camera',
        'videography': 'Camera',
        'decor': 'Sparkles',
        'decoration': 'Sparkles',
        'music': 'Music',
        'dj': 'Music',
        'entertainment': 'Music',
        'makeup': 'Brush',
        'mehendi': 'Brush',
        'transport': 'Car',
    }

    const categories = ((bookings || []) as BookingWithVendor[]).map((b) => {
        const rawVendor = b.vendors
        const vendor = Array.isArray(rawVendor) ? rawVendor[0] || {} : rawVendor || {}
        const serviceKey = (b.service || '').toLowerCase()
        const isPerPlate = serviceKey === 'catering'
        return {
            id: b.id,
            name: b.service || 'Service',
            icon: categoryIconMap[serviceKey] || 'Sparkles',
            vendor: {
                name: vendor.business_name || 'Partner',
                rating: vendor.rating || 4.5,
            },
            price: b.quoted_amount || b.budget || 0,
            perPlatePrice: isPerPlate ? (b.quoted_amount || b.budget || 0) / (event.guest_count || 1) : null,
            guestCount: isPerPlate ? event.guest_count : null,
            items: b.notes ? b.notes.split(',').map((s: string) => s.trim()) : [],
            status: b.status,
        }
    })

    const timelineFormatted = (timeline || []).map(t => ({
        id: t.id,
        time: t.start_time ? new Date(`2000-01-01T${t.start_time}`).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '',
        duration: t.duration ? `${t.duration} min` : null,
        title: t.title,
        description: t.description,
        category: t.category || 'general',
    }))

    const validDate = new Date(event.date || Date.now())
    validDate.setDate(validDate.getDate() - 7)

    return {
        proposal: {
            eventName: event.name,
            date: event.date,
            guestCount: event.guest_count,
            city: event.venue_address || event.venue_name || '',
            plannerName: planner?.business_name || 'Your Planner',
            plannerPhone: planner?.phone || '',
            personalMessage: `We're thrilled to be part of your ${event.type || 'event'}! Here's what we've curated for you.`,
            categories,
            timeline: timelineFormatted,
            status: event.proposal_status,
            validUntil: validDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
            postApprovalNote: 'Once approved, we will finalize all vendor bookings, confirm the timeline, and send you a detailed event day runsheet.',
        },
        error: null,
    }
}

/**
 * Update the proposal status (approve / request changes) by public token
 */
export async function updateProposalStatus(token: string, status: string, feedback?: string) {
    const supabase = await createClient()
    const cleanToken = token.startsWith('final_') ? token.slice(6) : token

    const updateData: { proposal_status: string; client_feedback?: string } = { proposal_status: status }
    if (feedback) updateData.client_feedback = feedback

    const { data: updatedEvents, error } = await supabase
        .from('events')
        .update(updateData)
        .eq('public_token', token)
        .select('id')
        .limit(1)

    if (error) {
        console.error('Error updating proposal status:', error)
        return { success: false, error: 'Failed to update' }
    }

    if ((updatedEvents || []).length > 0) {
        const updatedEventId = updatedEvents[0]?.id
        if (updatedEventId) {
            const { data: latestSnapshot } = await supabase
                .from('proposal_snapshots')
                .select('id')
                .eq('event_id', updatedEventId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle()

            if (latestSnapshot?.id) {
                const snapshotSyncPayload: { status: string; client_feedback?: string } = { status }
                if (feedback) snapshotSyncPayload.client_feedback = feedback

                const { error: snapshotSyncError } = await supabase
                    .from('proposal_snapshots')
                    .update(snapshotSyncPayload)
                    .eq('id', latestSnapshot.id)

                if (snapshotSyncError) {
                    console.error('Error syncing latest snapshot status from event update:', snapshotSyncError)
                }
            }
        }

        return { success: true }
    }

    const { data: updatedFinalEvents, error: finalTokenError } = await supabase
        .from('events')
        .update(updateData)
        .eq('final_proposal_token', cleanToken)
        .select('id')
        .limit(1)

    if (finalTokenError) {
        console.error('Error updating proposal status by final token:', finalTokenError)
        return { success: false, error: 'Failed to update' }
    }

    if ((updatedFinalEvents || []).length > 0) {
        const updatedEventId = updatedFinalEvents[0]?.id
        if (updatedEventId) {
            const { data: latestSnapshot } = await supabase
                .from('proposal_snapshots')
                .select('id')
                .eq('event_id', updatedEventId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle()

            if (latestSnapshot?.id) {
                const snapshotSyncPayload: { status: string; client_feedback?: string } = { status }
                if (feedback) snapshotSyncPayload.client_feedback = feedback

                const { error: snapshotSyncError } = await supabase
                    .from('proposal_snapshots')
                    .update(snapshotSyncPayload)
                    .eq('id', latestSnapshot.id)

                if (snapshotSyncError) {
                    console.error('Error syncing latest snapshot status from final token update:', snapshotSyncError)
                }
            }
        }

        return { success: true }
    }

    const snapshotUpdate: { status: string; client_feedback?: string } = { status }
    if (feedback) snapshotUpdate.client_feedback = feedback

    const { data: updatedSnapshots, error: snapshotError } = await supabase
        .from('proposal_snapshots')
        .update(snapshotUpdate)
        .eq('token', token)
        .select('id, event_id')
        .limit(1)

    if (snapshotError) {
        console.error('Error updating snapshot proposal status:', snapshotError)
        return { success: false, error: 'Failed to update' }
    }

    if ((updatedSnapshots || []).length === 0) {
        return { success: false, error: 'Proposal not found' }
    }

    const snapshotEventId = updatedSnapshots[0].event_id
    if (snapshotEventId) {
        const { error: eventSyncError } = await supabase
            .from('events')
            .update(updateData)
            .eq('id', snapshotEventId)

        if (eventSyncError) {
            console.error('Error syncing event proposal status:', eventSyncError)
        }
    }

    return { success: true }
}

/**
 * Get final (frozen) proposal by final_proposal_token
 */
export async function getFinalProposal(token: string) {
    const supabase = await createClient()

    // Strip 'final_' prefix if present
    const cleanToken = token.startsWith('final_') ? token.slice(6) : token

    const { data: event, error } = await supabase
        .from('events')
        .select(`
            id, name, date, venue_name, venue_address, type,
            guest_count, budget_max, proposal_status,
            planner_id
        `)
        .eq('final_proposal_token', cleanToken)
        .single()

    let resolvedEvent = event
    if (error || !resolvedEvent) {
        // Compatibility fallback: if a non-final token was opened under /proposal/final_*, try public token too.
        const { data: byPublicToken } = await supabase
            .from('events')
            .select(`
                id, name, date, venue_name, venue_address, type,
                guest_count, budget_max, proposal_status,
                planner_id
            `)
            .eq('public_token', cleanToken)
            .single()

        resolvedEvent = byPublicToken
    }

    if (!resolvedEvent) {
        // Snapshot fallback: some links can be snapshot tokens with a `final_` prefix.
        let snapshot: any = null
        const { data: snapshotByFullToken } = await supabase
            .from('proposal_snapshots')
            .select(`
                id,
                event_id,
                status,
                client_feedback,
                snapshot_data,
                created_at,
                events!inner(
                    id,
                    name,
                    date,
                    venue_name,
                    venue_address,
                    guest_count,
                    type,
                    proposal_status,
                    planner_id
                )
            `)
            .eq('token', token)
            .single()

        snapshot = snapshotByFullToken

        if (!snapshot && cleanToken !== token) {
            const { data: snapshotByCleanToken } = await supabase
                .from('proposal_snapshots')
                .select(`
                    id,
                    event_id,
                    status,
                    client_feedback,
                    snapshot_data,
                    created_at,
                    events!inner(
                        id,
                        name,
                        date,
                        venue_name,
                        venue_address,
                        guest_count,
                        type,
                        proposal_status,
                        planner_id
                    )
                `)
                .eq('token', cleanToken)
                .single()

            snapshot = snapshotByCleanToken
        }

        if (snapshot) {
            const snapshotData = (snapshot.snapshot_data || {}) as Record<string, any>
            const snapshotEvent = Array.isArray(snapshot.events) ? snapshot.events[0] : snapshot.events

            let plannerName = 'Your Planner'
            let plannerPhone = ''
            if (snapshotEvent?.planner_id) {
                const { data: planner } = await supabase
                    .from('planner_profiles')
                    .select('business_name, phone')
                    .eq('user_id', snapshotEvent.planner_id)
                    .single()

                plannerName = planner?.business_name || plannerName
                plannerPhone = planner?.phone || plannerPhone
            }

            const proposalStatus = snapshot.status || snapshotEvent?.proposal_status || 'final'

            return {
                proposal: {
                    eventName: (snapshotData.eventName as string) || snapshotEvent?.name || 'Your Event',
                    date: (snapshotData.date as string) || snapshotEvent?.date || new Date(snapshot.created_at).toISOString(),
                    guestCount: (snapshotData.guestCount as number) || snapshotEvent?.guest_count || 0,
                    city: (snapshotData.city as string) || snapshotEvent?.venue_address || snapshotEvent?.venue_name || '',
                    plannerName: (snapshotData.plannerName as string) || plannerName,
                    plannerPhone,
                    personalMessage: (snapshotData.personalMessage as string) || `Final proposal for your ${snapshotEvent?.type || 'event'}.`,
                    categories: Array.isArray(snapshotData.categories) ? snapshotData.categories : [],
                    timeline: Array.isArray(snapshotData.timeline) ? snapshotData.timeline : [],
                    status: proposalStatus,
                    validUntil: (snapshotData.validUntil as string) || 'Final Version',
                    postApprovalNote: (snapshotData.postApprovalNote as string) || 'This is the final proposal. Upon approval, execution begins.',
                },
                status: proposalStatus,
                error: null,
            }
        }

        return { error: 'Final proposal not found' }
    }

    // Reuse the same proposal builder
    const { data: planner } = await supabase
        .from('planner_profiles')
        .select('business_name, phone')
        .eq('user_id', resolvedEvent.planner_id)
        .single()

    const { data: bookings } = await supabase
        .from('booking_requests')
        .select(`
            id, service, status, budget, quoted_amount, notes,
            vendors:vendor_id (business_name, rating, category)
        `)
        .eq('event_id', resolvedEvent.id)
        .in('status', ['accepted', 'confirmed'])

    const { data: timeline } = await supabase
        .from('timeline_items')
        .select('*')
        .eq('event_id', resolvedEvent.id)
        .order('start_time', { ascending: true })

    const categoryIconMap: Record<string, string> = {
        'venue': 'Building2', 'catering': 'UtensilsCrossed', 'photography': 'Camera',
        'videography': 'Camera', 'decor': 'Sparkles', 'decoration': 'Sparkles',
        'music': 'Music', 'dj': 'Music', 'entertainment': 'Music',
        'makeup': 'Brush', 'mehendi': 'Brush', 'transport': 'Car',
    }

    const categories = ((bookings || []) as BookingWithVendor[]).map((b) => {
        const rawVendor = b.vendors
        const vendor = Array.isArray(rawVendor) ? rawVendor[0] || {} : rawVendor || {}
        const serviceKey = (b.service || '').toLowerCase()
        const isPerPlate = serviceKey === 'catering'
        return {
            id: b.id, name: b.service || 'Service',
            icon: categoryIconMap[serviceKey] || 'Sparkles',
            vendor: { name: vendor.business_name || 'Partner', rating: vendor.rating || 4.5 },
            price: b.quoted_amount || b.budget || 0,
            perPlatePrice: isPerPlate ? (b.quoted_amount || b.budget || 0) / (resolvedEvent.guest_count || 1) : null,
            guestCount: isPerPlate ? resolvedEvent.guest_count : null,
            items: b.notes ? b.notes.split(',').map((s: string) => s.trim()) : [],
            status: b.status,
        }
    })

    const timelineFormatted = (timeline || []).map(t => ({
        id: t.id,
        time: t.start_time ? new Date(`2000-01-01T${t.start_time}`).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '',
        duration: t.duration ? `${t.duration} min` : null,
        title: t.title, description: t.description, category: t.category || 'general',
    }))

    return {
        proposal: {
            eventName: resolvedEvent.name, date: resolvedEvent.date,
            guestCount: resolvedEvent.guest_count,
            city: resolvedEvent.venue_address || resolvedEvent.venue_name || '',
            plannerName: planner?.business_name || 'Your Planner',
            plannerPhone: planner?.phone || '',
            personalMessage: `Final proposal for your ${resolvedEvent.type || 'event'}.`,
            categories, timeline: timelineFormatted,
            status: resolvedEvent.proposal_status,
            validUntil: 'Final Version',
            postApprovalNote: 'This is the final proposal. Upon approval, execution begins.',
        },
        status: resolvedEvent.proposal_status,
        error: null,
    }
}

/**
 * Update final proposal status (approve / request changes) by final_proposal_token
 */
export async function updateFinalProposalStatus(token: string, status: string, feedback?: string) {
    const supabase = await createClient()

    const cleanToken = token.startsWith('final_') ? token.slice(6) : token
    const updateData: { proposal_status: string; client_feedback?: string } = { proposal_status: status }
    if (feedback) updateData.client_feedback = feedback

    const { data: updatedEvents, error } = await supabase
        .from('events')
        .update(updateData)
        .eq('final_proposal_token', cleanToken)
        .select('id')
        .limit(1)

    if (error) {
        console.error('Error updating final proposal status:', error)
        return { success: false, error: 'Failed to update' }
    }

    if ((updatedEvents || []).length > 0) {
        const updatedEventId = updatedEvents[0]?.id
        if (updatedEventId) {
            const { data: latestSnapshot } = await supabase
                .from('proposal_snapshots')
                .select('id')
                .eq('event_id', updatedEventId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle()

            if (latestSnapshot?.id) {
                const snapshotSyncPayload: { status: string; client_feedback?: string } = { status }
                if (feedback) snapshotSyncPayload.client_feedback = feedback

                const { error: snapshotSyncError } = await supabase
                    .from('proposal_snapshots')
                    .update(snapshotSyncPayload)
                    .eq('id', latestSnapshot.id)

                if (snapshotSyncError) {
                    console.error('Error syncing latest snapshot status from final event update:', snapshotSyncError)
                }
            }
        }

        revalidatePath('/planner/proposals')
        revalidatePath(`/planner/events/${updatedEventId}/proposal`)
        revalidatePath(`/planner/events/${updatedEventId}/client`)
        return { success: true }
    }

    // Compatibility fallback: if this is actually a snapshot token, update snapshot status.
    const snapshotUpdate: { status: string; client_feedback?: string } = { status }
    if (feedback) snapshotUpdate.client_feedback = feedback

    let updatedSnapshots: { id: string }[] | null = null

    const { data: updatedSnapshotsByCleanToken, error: snapshotError } = await supabase
        .from('proposal_snapshots')
        .update(snapshotUpdate)
        .eq('token', cleanToken)
        .select('id')
        .limit(1)

    updatedSnapshots = updatedSnapshotsByCleanToken

    if (!snapshotError && (updatedSnapshots || []).length === 0 && cleanToken !== token) {
        const { data: updatedSnapshotsByFullToken, error: fullTokenSnapshotError } = await supabase
            .from('proposal_snapshots')
            .update(snapshotUpdate)
            .eq('token', token)
            .select('id')
            .limit(1)

        if (!fullTokenSnapshotError) {
            updatedSnapshots = updatedSnapshotsByFullToken
        }
    }

    if (snapshotError) {
        console.error('Error updating final snapshot proposal status:', snapshotError)
        return { success: false, error: 'Failed to update' }
    }

    if ((updatedSnapshots || []).length === 0) {
        return { success: false, error: 'Final proposal not found' }
    }

    revalidatePath('/planner/proposals')
    return { success: true }
}

// ============================================================================
// GENERATE PROPOSAL TOKEN (used by send-panel)
// ============================================================================

/**
 * Generate a public proposal token for an event
 */
export async function generateProposalToken(eventId: string) {
    const supabase = await createClient()
    const session = await getSession();
    
    if (!session?.userId) return { error: 'Unauthorized' }

    const token = crypto.randomUUID()

    const { error } = await supabase
        .from('events')
        .update({ public_token: token, proposal_status: 'sent' })
        .eq('id', eventId)
        .eq('planner_id', session?.userId)

    if (error) {
        console.error('generateProposalToken error:', error)
        return { error: 'Failed to generate token' }
    }

    revalidatePath(`/planner/events/${eventId}`)
    return { success: true, token }
}

/**
 * Save builder progress as draft status.
 */
export async function saveProposalDraft(eventId: string) {
    const supabase = await createClient()
    const session = await getSession();

    if (!session?.userId) return { error: 'Unauthorized' }

    const { error } = await supabase
        .from('events')
        .update({ proposal_status: 'draft' })
        .eq('id', eventId)
        .eq('planner_id', session?.userId)

    if (error) {
        console.error('saveProposalDraft error:', error)
        return { error: 'Failed to save draft' }
    }

    revalidatePath(`/planner/events/${eventId}/builder`)
    return { success: true }
}

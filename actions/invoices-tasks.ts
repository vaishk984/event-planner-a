'use server'
import { createClient } from '@/lib/supabase/server'
import { getUserId } from '@/lib/session'
import { createLogger } from '@/lib/logger'
import { revalidatePath } from 'next/cache'

const logger = createLogger('InvoicesTasks')

function getMissingColumnFromError(error: unknown): string | null {
    const message = (error as { message?: string } | null)?.message || ''
    const match = message.match(/Could not find the '([^']+)' column/i)
    return match ? match[1] : null
}

function normalizeInvoiceRow(row: any, eventName?: string) {
    return {
        ...row,
        subtotal: row.subtotal ?? row.amount ?? 0,
        platform_fee: row.platform_fee ?? 0,
        total: row.total ?? row.amount ?? 0,
        paid_amount: row.paid_amount ?? 0,
        events: row.events
            ? (Array.isArray(row.events) ? row.events[0] : row.events)
            : (eventName ? { name: eventName } : undefined),
    }
}

// ============================================================================
// INVOICE ACTIONS
// ============================================================================

export async function getInvoices() {
    const supabase = await createClient()
    const userId = await getUserId()
    if (!userId) return { error: 'Unauthorized', data: [] }

    const { data, error } = await supabase
        .from('invoices')
        .select('*, events(name)')
        .eq('planner_id', userId)
        .order('created_at', { ascending: false })

    if (error && getMissingColumnFromError(error) !== 'planner_id') {
        logger.error('Failed to fetch invoices with join', error)
    }

    // Fallback path: always fetch planner-owned events, then invoices by event_id.
    // This covers legacy rows where planner_id is missing or null.
    const { data: ownedEvents, error: eventsError } = await supabase
        .from('events')
        .select('id, name')
        .eq('planner_id', userId)

    if (eventsError) {
        logger.error('Failed to fetch planner events for invoice fallback', eventsError)
    }

    const eventIds = (ownedEvents || []).map(e => e.id)
    const eventNameById = new Map((ownedEvents || []).map(e => [e.id, e.name]))

    let fallbackData: any[] = []
    if (eventIds.length > 0) {
        const { data: byEventData, error: byEventError } = await supabase
            .from('invoices')
            .select('*')
            .in('event_id', eventIds)
            .order('created_at', { ascending: false })

        if (byEventError) {
            logger.error('Failed to fetch invoices by owned events', byEventError)
        } else {
            fallbackData = byEventData || []
        }
    }

    const merged = [...(data || []), ...fallbackData]
    const dedupedById = new Map<string, any>()
    for (const row of merged) {
        if (row?.id && !dedupedById.has(row.id)) dedupedById.set(row.id, row)
    }

    const normalized = Array.from(dedupedById.values()).map((row: any) =>
        normalizeInvoiceRow(row, eventNameById.get(row.event_id))
    )

    normalized.sort((a: any, b: any) => {
        const aTs = a?.created_at ? new Date(a.created_at).getTime() : 0
        const bTs = b?.created_at ? new Date(b.created_at).getTime() : 0
        return bTs - aTs
    })

    return { data: normalized }
}

export async function getInvoicesByEvent(eventId: string) {
    const supabase = await createClient()
    const userId = await getUserId()

    if (!userId) {
        return { error: 'Unauthorized', data: [] }
    }

    const { data, error } = await supabase
        .from('invoices')
        .select('*, invoice_items(*)')
        .eq('planner_id', userId)
        .eq('event_id', eventId)
        .order('created_at', { ascending: false })

    if (error) {
        if (getMissingColumnFromError(error) === 'planner_id') {
            const { data: legacyData, error: legacyError } = await supabase
                .from('invoices')
                .select('*, invoice_items(*)')
                .eq('event_id', eventId)
                .order('created_at', { ascending: false })

            if (legacyError) {
                logger.error('Failed to fetch invoices by event (legacy fallback)', legacyError)
                return { data: [] }
            }

            const normalized = (legacyData || []).map((row: any) => normalizeInvoiceRow(row))

            return { data: normalized }
        }

        logger.error('Failed to fetch invoices by event', error)
        return { data: [] }
    }

    // If planner_id filter returns empty due legacy null values, verify ownership by event and retry.
    if ((data || []).length === 0) {
        const { data: event, error: eventError } = await supabase
            .from('events')
            .select('id')
            .eq('id', eventId)
            .eq('planner_id', userId)
            .single()

        if (!eventError && event) {
            const { data: byEventRows, error: byEventError } = await supabase
                .from('invoices')
                .select('*, invoice_items(*)')
                .eq('event_id', eventId)
                .order('created_at', { ascending: false })

            if (!byEventError) {
                return { data: (byEventRows || []).map((row: any) => normalizeInvoiceRow(row)) }
            }
        }
    }

    const normalized = (data || []).map((row: any) => normalizeInvoiceRow(row))

    return { data: normalized }
}

export async function createInvoice(formData: {
    eventId: string
    clientName: string
    clientEmail?: string
    clientPhone?: string
    dueDate?: string
    items: { description: string; quantity: number; rate: number }[]
    notes?: string
}) {
    const supabase = await createClient()
    const userId = await getUserId()
    if (!userId) return { error: 'Unauthorized' }

    // Generate invoice number
    const { count } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })

    const invoiceNumber = `INV-${String((count || 0) + 1).padStart(4, '0')}`

    // Calculate totals
    const subtotal = formData.items.reduce((sum, item) => sum + (item.quantity * item.rate), 0)
    const platformFee = Math.round(subtotal * 0.02)
    const total = subtotal + platformFee

    // Accept both yyyy-mm-dd and dd-mm-yyyy date formats from UI/input.
    const dueDateRaw = (formData.dueDate || '').trim()
    const dueDate = /^\d{2}-\d{2}-\d{4}$/.test(dueDateRaw)
        ? `${dueDateRaw.slice(6, 10)}-${dueDateRaw.slice(3, 5)}-${dueDateRaw.slice(0, 2)}`
        : (dueDateRaw || null)

    // Insert invoice with compatibility fallback for legacy schemas.
    const insertPayload: Record<string, any> = {
        event_id: formData.eventId,
        planner_id: userId,
        invoice_number: invoiceNumber,
        client_name: formData.clientName,
        client_email: formData.clientEmail || '',
        client_phone: formData.clientPhone || '',
        due_date: dueDate,
        subtotal,
        platform_fee: platformFee,
        total,
        notes: formData.notes || '',
        status: 'draft',
    }

    let invoice: any = null
    let invoiceError: any = null

    for (let attempt = 0; attempt < 30; attempt++) {
        const result = await supabase
            .from('invoices')
            .insert(insertPayload)
            .select()
            .single()

        invoice = result.data
        invoiceError = result.error

        if (!invoiceError && invoice) break

        const message = invoiceError?.message || ''
        const missingColumn = getMissingColumnFromError(invoiceError)
        if (missingColumn) {
            delete insertPayload[missingColumn]
            continue
        }

        // Older schemas may still require legacy columns.
        if (message.includes('null value in column "amount"')) {
            insertPayload.amount = total
            continue
        }
        if (message.includes('null value in column "type"')) {
            insertPayload.type = 'service'
            continue
        }

        break
    }

    if (invoiceError || !invoice) {
        logger.error('Failed to create invoice', {
            invoiceError,
            eventId: formData.eventId,
            plannerId: userId,
            payloadKeys: Object.keys(insertPayload),
        })
        return { error: invoiceError?.message || 'Failed to create invoice' }
    }

    // Insert items
    if (formData.items.length > 0) {
        const itemRows = formData.items.map(item => ({
            invoice_id: invoice.id,
            description: item.description,
            quantity: item.quantity,
            rate: item.rate,
            amount: item.quantity * item.rate,
        }))

        await supabase.from('invoice_items').insert(itemRows)
    }

    revalidatePath('/planner/invoices')
    return { success: true, invoice }
}

export async function createInitialInvoiceForEvent(input: {
    eventId: string
    eventName?: string
    clientName?: string
    clientEmail?: string
    clientPhone?: string
    budgetMax?: number
    eventDate?: string
}) {
    const supabase = await createClient()
    const userId = await getUserId()
    if (!userId) return { error: 'Unauthorized' }

    // Avoid creating duplicate seed invoices for the same event.
    let existingCount = 0
    const { count, error } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', input.eventId)
        .eq('planner_id', userId)

    if (!error) {
        existingCount = count || 0
    } else if (getMissingColumnFromError(error) === 'planner_id') {
        // Legacy schema fallback.
        const { count: fallbackCount } = await supabase
            .from('invoices')
            .select('*', { count: 'exact', head: true })
            .eq('event_id', input.eventId)
        existingCount = fallbackCount || 0
    }

    if (existingCount > 0) {
        return { success: true, skipped: true }
    }

    const budget = Math.max(0, Math.round(Number(input.budgetMax || 0)))
    const dueDate = input.eventDate && /^\d{4}-\d{2}-\d{2}/.test(input.eventDate)
        ? input.eventDate.slice(0, 10)
        : undefined

    const result = await createInvoice({
        eventId: input.eventId,
        clientName: input.clientName?.trim() || 'Client',
        clientEmail: input.clientEmail?.trim() || '',
        clientPhone: input.clientPhone?.trim() || '',
        dueDate,
        notes: 'Auto-generated initial invoice from event creation.',
        items: [
            {
                description: input.eventName
                    ? `Initial estimate for ${input.eventName}`
                    : 'Initial estimate',
                quantity: 1,
                rate: budget,
            },
        ],
    })

    return result
}

export async function updateInvoiceStatus(invoiceId: string, status: string) {
    const supabase = await createClient()
    const userId = await getUserId()

    if (!userId) {
        return { error: 'Unauthorized' }
    }

    const updateData: any = { status, updated_at: new Date().toISOString() }
    if (status === 'paid') {
        updateData.paid_at = new Date().toISOString()
        // Get invoice total to set paid_amount
        const { data: inv } = await supabase
            .from('invoices')
            .select('total, amount')
            .eq('id', invoiceId)
            .single()
        if (inv) updateData.paid_amount = inv.total ?? inv.amount ?? 0
    }

    let { error } = await supabase
        .from('invoices')
        .update(updateData)
        .eq('id', invoiceId)
        .eq('planner_id', userId)

    if (getMissingColumnFromError(error) === 'planner_id') {
        // Legacy schema path: ensure ownership via joined events, then update by id.
        const { data: ownership, error: ownershipError } = await supabase
            .from('invoices')
            .select('id, events!inner(planner_id)')
            .eq('id', invoiceId)
            .eq('events.planner_id', userId)
            .single()

        if (ownershipError || !ownership) {
            logger.error('Failed invoice ownership check (legacy)', ownershipError)
            return { error: 'Unauthorized' }
        }

        const compatibilityUpdate = { ...updateData }
        // Legacy table may not have these columns.
        let updateAttempts = 0
        while (updateAttempts < 10) {
            updateAttempts += 1
            const result = await supabase
                .from('invoices')
                .update(compatibilityUpdate)
                .eq('id', invoiceId)
            error = result.error
            if (!error) break
            const missing = getMissingColumnFromError(error)
            if (missing) {
                delete compatibilityUpdate[missing]
                continue
            }
            break
        }
    }

    if (error) {
        logger.error('Failed to update invoice status', error)
        return { error: 'Failed to update invoice' }
    }

    revalidatePath('/planner/invoices')
    return { success: true }
}

// ============================================================================
// TASK ACTIONS
// ============================================================================

export async function getTasks() {
    const supabase = await createClient()
    const userId = await getUserId()
    if (!userId) return { error: 'Unauthorized', data: [] }

    const { data, error } = await supabase
        .from('tasks')
        .select('*, events(name)')
        .eq('planner_id', userId)
        .order('created_at', { ascending: false })

    if (error) {
        logger.error('Failed to fetch tasks with join', error)
        const { data: fallback } = await supabase
            .from('tasks')
            .select('*')
            .eq('planner_id', userId)
            .order('created_at', { ascending: false })
        return { data: fallback || [] }
    }

    return { data: data || [] }
}

export async function getTasksByEvent(eventId: string) {
    const supabase = await createClient()
    const userId = await getUserId()

    if (!userId) {
        return { error: 'Unauthorized', data: [] }
    }

    const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('planner_id', userId)
        .eq('event_id', eventId)
        .order('due_date', { ascending: true })

    if (error) {
        logger.error('Failed to fetch tasks by event', error)
        return { data: [] }
    }

    return { data: data || [] }
}

export async function createTask(formData: {
    eventId?: string
    title: string
    description?: string
    priority?: string
    dueDate?: string
    assignedTo?: string
    category?: string
}) {
    const supabase = await createClient()
    const userId = await getUserId()
    if (!userId) return { error: 'Unauthorized' }

    const { data, error } = await supabase
        .from('tasks')
        .insert({
            event_id: formData.eventId || null,
            planner_id: userId,
            title: formData.title,
            description: formData.description || '',
            priority: formData.priority || 'medium',
            due_date: formData.dueDate || null,
            assigned_to: formData.assignedTo || '',
            category: formData.category || 'general',
        })
        .select()
        .single()

    if (error) {
        logger.error('Failed to create task', error)
        return { error: 'Failed to create task' }
    }

    revalidatePath('/planner/tasks')
    return { success: true, task: data }
}

export async function updateTaskStatus(taskId: string, status: string) {
    const supabase = await createClient()
    const userId = await getUserId()

    if (!userId) {
        return { error: 'Unauthorized' }
    }

    const { error } = await supabase
        .from('tasks')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', taskId)
        .eq('planner_id', userId)

    if (error) {
        logger.error('Failed to update task status', error)
        return { error: 'Failed to update task' }
    }

    revalidatePath('/planner/tasks')
    return { success: true }
}

export async function deleteTask(taskId: string) {
    const supabase = await createClient()
    const userId = await getUserId()

    if (!userId) {
        return { error: 'Unauthorized' }
    }

    const { error } = await supabase
        .from('tasks')
        .delete()
        .eq('id', taskId)
        .eq('planner_id', userId)

    if (error) {
        logger.error('Failed to delete task', error)
        return { error: 'Failed to delete task' }
    }

    revalidatePath('/planner/tasks')
    return { success: true }
}

'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    FileText, Download, Send, Printer,
    IndianRupee, Calendar, User, Building2,
    CheckCircle2, Clock, AlertCircle, Search,
    CreditCard, Receipt, Loader2, Plus, X, Trash2
} from 'lucide-react'
import { getInvoices, updateInvoiceStatus, createInvoice } from '@/actions/invoices-tasks'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'

function getStatusColor(status: string) {
    switch (status) {
        case 'draft': return 'bg-gray-100 text-gray-700'
        case 'sent': return 'bg-blue-100 text-blue-700'
        case 'paid': return 'bg-green-100 text-green-700'
        case 'overdue': return 'bg-red-100 text-red-700'
        case 'cancelled': return 'bg-gray-100 text-gray-500'
        default: return 'bg-gray-100 text-gray-700'
    }
}

function getStatusLabel(status: string) {
    switch (status) {
        case 'draft': return 'Draft'
        case 'sent': return 'Sent'
        case 'paid': return 'Paid ✓'
        case 'overdue': return 'Overdue'
        case 'cancelled': return 'Cancelled'
        default: return status
    }
}

interface Invoice {
    id: string
    invoice_number: string
    event_id: string
    client_name: string
    client_email?: string
    status: string
    subtotal: number
    platform_fee: number
    total: number
    paid_amount: number
    due_date?: string
    paid_at?: string
    created_at: string
    events?: { name: string }
}

export default function InvoicesPage() {
    const [invoices, setInvoices] = useState<Invoice[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [sending, setSending] = useState(false)
    const [exporting, setExporting] = useState(false)
    const [showCreateDialog, setShowCreateDialog] = useState(false)

    useEffect(() => {
        fetchInvoices()
    }, [])

    const fetchInvoices = async () => {
        const result = await getInvoices()
        const nextInvoices = result.data || []
        setInvoices(nextInvoices)
        setSelectedInvoice((prev) => {
            if (!nextInvoices.length) return null
            if (!prev) return nextInvoices[0]
            return nextInvoices.find((invoice) => invoice.id === prev.id) || nextInvoices[0]
        })
        setLoading(false)
    }

    // Stats
    const totalCount = invoices.length
    const pendingAmount = invoices
        .filter(i => i.status === 'sent' || i.status === 'overdue')
        .reduce((sum, i) => sum + ((i.total || 0) - (i.paid_amount || 0)), 0)
    const paidAmount = invoices
        .filter(i => i.status === 'paid')
        .reduce((sum, i) => sum + (i.total || 0), 0)
    const overdueCount = invoices.filter(i => i.status === 'overdue').length

    const filteredInvoices = invoices.filter(i =>
        (i.client_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (i.invoice_number || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (i.events?.name || '').toLowerCase().includes(searchQuery.toLowerCase())
    )

    async function handleSendInvoice() {
        if (!selectedInvoice) return
        setSending(true)
        const result = await updateInvoiceStatus(selectedInvoice.id, 'sent')
        if (result.success) {
            toast.success(`Invoice sent to ${selectedInvoice.client_email || 'client'}`)
            await fetchInvoices()
            setSelectedInvoice({ ...selectedInvoice, status: 'sent' })
        } else {
            toast.error(result.error || 'Failed to send invoice')
        }
        setSending(false)
    }

    async function handleMarkPaid() {
        if (!selectedInvoice) return
        const result = await updateInvoiceStatus(selectedInvoice.id, 'paid')
        if (result.success) {
            toast.success('Invoice marked as paid')
            await fetchInvoices()
            setSelectedInvoice({ ...selectedInvoice, status: 'paid', paid_amount: selectedInvoice.total })
        } else {
            toast.error(result.error || 'Failed to update invoice status')
        }
    }

    const buildInvoicePrintHtml = (invoice: Invoice) => {
        const escapeHtml = (value: string) => value
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;')

        const formatCurrency = (amount: number) => `₹${(amount || 0).toLocaleString('en-IN')}`

        const created = new Date(invoice.created_at).toLocaleDateString('en-IN')
        const due = invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('en-IN') : 'N/A'
        const invoiceLabel = escapeHtml(invoice.invoice_number || 'INVOICE')
        const clientName = escapeHtml(invoice.client_name || 'Client')
        const clientEmail = escapeHtml(invoice.client_email || '')
        const eventName = escapeHtml(invoice.events?.name || 'Event')
        const statusLabel = escapeHtml(getStatusLabel(invoice.status))

        return `<!doctype html>
<html>
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${invoiceLabel}</title>
    <style>
        * { box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; background: #f5f7fb; color: #0f172a; }
        .page { max-width: 900px; margin: 0 auto; padding: 28px; }
        .card { background: #ffffff; border: 1px solid #dbe4f0; border-radius: 16px; padding: 28px; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 20px; }
        .brand { color: #1d4ed8; font-weight: 700; letter-spacing: 0.02em; font-size: 14px; }
        .title { font-size: 30px; font-weight: 700; margin: 4px 0 0; color: #111827; }
        .meta { color: #64748b; font-size: 13px; line-height: 1.6; text-align: right; }
        .pill { display: inline-block; font-size: 12px; font-weight: 600; border: 1px solid #cbd5e1; color: #334155; border-radius: 999px; padding: 4px 10px; margin-top: 8px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin: 18px 0 24px; }
        .section { border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; }
        .label { color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }
        .value { font-size: 16px; font-weight: 600; }
        .muted { color: #64748b; font-size: 13px; }
        .table { width: 100%; border-collapse: collapse; margin-top: 4px; }
        .table th, .table td { border-bottom: 1px solid #e2e8f0; padding: 10px 8px; font-size: 14px; }
        .table th { color: #64748b; font-weight: 600; text-align: left; }
        .table td:last-child, .table th:last-child { text-align: right; }
        .totals { margin-left: auto; width: 340px; margin-top: 18px; }
        .row { display: flex; justify-content: space-between; padding: 7px 0; color: #334155; }
        .grand { border-top: 2px solid #dbe4f0; margin-top: 8px; padding-top: 12px; font-size: 22px; font-weight: 700; color: #0f172a; }
        .footer { margin-top: 28px; color: #64748b; font-size: 12px; text-align: center; }
        @media print {
            body { background: #ffffff; }
            .page { max-width: none; margin: 0; padding: 0; }
            .card { border: none; border-radius: 0; padding: 0; }
        }
    </style>
</head>
<body>
    <div class="page">
        <div class="card">
            <div class="header">
                <div>
                    <div class="brand">PlannerOS Billing</div>
                    <h1 class="title">Invoice</h1>
                    <div class="muted">${invoiceLabel}</div>
                </div>
                <div class="meta">
                    Created: ${created}<br/>
                    Due: ${due}<br/>
                    <span class="pill">${statusLabel}</span>
                </div>
            </div>

            <div class="grid">
                <div class="section">
                    <div class="label">Bill To</div>
                    <div class="value">${clientName}</div>
                    <div class="muted">${clientEmail}</div>
                </div>
                <div class="section">
                    <div class="label">Event</div>
                    <div class="value">${eventName}</div>
                    <div class="muted">Professional event planning services</div>
                </div>
            </div>

            <table class="table">
                <thead>
                    <tr>
                        <th>Description</th>
                        <th>Amount</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Event planning services</td>
                        <td>${formatCurrency(invoice.subtotal || 0)}</td>
                    </tr>
                    <tr>
                        <td>Platform fee (2%)</td>
                        <td>${formatCurrency(invoice.platform_fee || 0)}</td>
                    </tr>
                </tbody>
            </table>

            <div class="totals">
                <div class="row"><span>Subtotal</span><span>${formatCurrency(invoice.subtotal || 0)}</span></div>
                <div class="row"><span>Platform Fee</span><span>${formatCurrency(invoice.platform_fee || 0)}</span></div>
                <div class="row grand"><span>Total</span><span>${formatCurrency(invoice.total || 0)}</span></div>
            </div>

            <div class="footer">
                This document is system-generated by PlannerOS.
            </div>
        </div>
    </div>
</body>
</html>`
    }

    const openInvoicePrintDialog = (invoice: Invoice, pdfMode: boolean) => {
        const html = buildInvoicePrintHtml(invoice)
        const iframe = document.createElement('iframe')
        iframe.style.position = 'fixed'
        iframe.style.width = '0'
        iframe.style.height = '0'
        iframe.style.border = '0'
        iframe.style.right = '0'
        iframe.style.bottom = '0'
        document.body.appendChild(iframe)

        const frameWindow = iframe.contentWindow
        if (!frameWindow) {
            document.body.removeChild(iframe)
            toast.error('Unable to open print view. Please try again.')
            setExporting(false)
            return
        }

        let cleanedUp = false
        const cleanup = () => {
            if (cleanedUp) return
            cleanedUp = true
            setExporting(false)
            if (document.body.contains(iframe)) {
                document.body.removeChild(iframe)
            }
        }

        frameWindow.document.open()
        frameWindow.document.write(html)
        frameWindow.document.close()
        frameWindow.document.title = invoice.invoice_number || 'Invoice'

        frameWindow.onload = () => {
            frameWindow.focus()
            frameWindow.print()
            frameWindow.onafterprint = cleanup
            // Fallback because some browsers may not fire onafterprint for iframe content.
            window.setTimeout(cleanup, 1500)
        }

        // Extra safeguard if iframe load does not finish.
        window.setTimeout(cleanup, 4000)

        if (pdfMode) {
            toast.success('Print dialog opened. Choose "Save as PDF" to download.')
        }
    }

    const handlePrintInvoice = () => {
        if (!selectedInvoice) return
        setExporting(true)
        openInvoicePrintDialog(selectedInvoice, false)
    }

    const handleDownloadPdf = () => {
        if (!selectedInvoice) return
        setExporting(true)
        openInvoicePrintDialog(selectedInvoice, true)
    }

    useEffect(() => {
        if (selectedInvoice) {
            setExporting(false)
        }
    }, [selectedInvoice?.id])

    if (loading) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Invoices</h1>
                    <p className="text-gray-500">Manage client invoices and payments</p>
                </div>
                <Button
                    className="bg-indigo-600 hover:bg-indigo-700 gap-2"
                    onClick={() => setShowCreateDialog(true)}
                >
                    <Plus className="w-4 h-4" />
                    Create Invoice
                </Button>
            </div>

            {/* Create Invoice Dialog */}
            {showCreateDialog && (
                <CreateInvoiceDialog
                    onClose={() => setShowCreateDialog(false)}
                    onCreated={() => { setShowCreateDialog(false); fetchInvoices() }}
                />
            )}

            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-4">
                <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                                <Receipt className="w-5 h-5 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-blue-700">{totalCount}</p>
                                <p className="text-sm text-blue-600">Total Invoices</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200">
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                                <Clock className="w-5 h-5 text-amber-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-amber-700">₹{(pendingAmount / 100000).toFixed(1)}L</p>
                                <p className="text-sm text-amber-600">Pending</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                                <CreditCard className="w-5 h-5 text-green-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-green-700">₹{(paidAmount / 100000).toFixed(1)}L</p>
                                <p className="text-sm text-green-600">Collected</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-red-50 to-rose-50 border-red-200">
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
                                <AlertCircle className="w-5 h-5 text-red-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-red-700">{overdueCount}</p>
                                <p className="text-sm text-red-600">Overdue</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Search */}
            <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                    placeholder="Search by invoice #, event or client..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Invoices List */}
                <div className="lg:col-span-1 space-y-3">
                    <h2 className="font-semibold text-gray-700">All Invoices</h2>
                    {filteredInvoices.length === 0 ? (
                        <Card className="p-8 text-center">
                            <Receipt className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                            <p className="text-gray-500">No invoices yet</p>
                            <p className="text-sm text-gray-400 mt-1">Invoices will appear here when created</p>
                        </Card>
                    ) : (
                        filteredInvoices.map((invoice) => (
                            <Card
                                key={invoice.id}
                                className={`cursor-pointer transition-all hover:shadow-md hover:border-indigo-300 ${selectedInvoice?.id === invoice.id ? 'ring-2 ring-indigo-500 border-indigo-400' : ''}`}
                                onClick={() => setSelectedInvoice(invoice)}
                            >
                                <CardContent className="p-4">
                                    <div className="flex items-start justify-between mb-2">
                                        <div>
                                            <p className="text-sm font-medium text-indigo-600">{invoice.invoice_number}</p>
                                            <h3 className="font-semibold text-gray-900">{invoice.events?.name || 'Event'}</h3>
                                            <p className="text-sm text-gray-500">{invoice.client_name}</p>
                                        </div>
                                        <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(invoice.status)}`}>
                                            {getStatusLabel(invoice.status)}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between text-sm mt-2 pt-2 border-t">
                                        <div className="flex items-center gap-1 text-gray-500">
                                            <Calendar className="w-3 h-3" />
                                            Due: {invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : 'N/A'}
                                        </div>
                                        <div className="font-semibold text-gray-900">
                                            ₹{((invoice.total || 0) / 100000).toFixed(2)}L
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))
                    )}
                </div>

                {/* Invoice Detail */}
                <div className="lg:col-span-2">
                    {selectedInvoice ? (
                        <Card className="overflow-hidden">
                            <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white p-6">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <div className="flex items-center gap-2 mb-2">
                                            <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                                                <FileText className="w-6 h-6" />
                                            </div>
                                            <span className="text-2xl font-bold">INVOICE</span>
                                        </div>
                                        <div className="text-indigo-100 text-sm">{selectedInvoice.invoice_number}</div>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="bg-white/10 border-white/20 text-white hover:bg-white/20"
                                            onClick={handlePrintInvoice}
                                            disabled={exporting}
                                        >
                                            <Printer className="w-4 h-4 mr-1" /> Print
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="bg-white/10 border-white/20 text-white hover:bg-white/20"
                                            onClick={handleDownloadPdf}
                                            disabled={exporting}
                                        >
                                            <Download className="w-4 h-4 mr-1" /> PDF
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            <CardContent className="p-6">
                                <div className="grid grid-cols-2 gap-6 mb-6">
                                    <div>
                                        <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">Bill To</h3>
                                        <div className="flex items-center gap-2 text-gray-900 font-medium">
                                            <User className="w-4 h-4 text-gray-400" />
                                            {selectedInvoice.client_name}
                                        </div>
                                        {selectedInvoice.client_email && (
                                            <div className="text-gray-600 text-sm">{selectedInvoice.client_email}</div>
                                        )}
                                    </div>
                                    <div className="text-right">
                                        <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">Event</h3>
                                        <div className="flex items-center gap-2 justify-end text-gray-900 font-medium">
                                            <Building2 className="w-4 h-4 text-gray-400" />
                                            {selectedInvoice.events?.name || 'Event'}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex gap-6 mb-6 text-sm p-3 bg-gray-50 rounded-lg">
                                    <div>
                                        <span className="text-gray-500">Created:</span>
                                        <span className="ml-2 font-medium">{new Date(selectedInvoice.created_at).toLocaleDateString()}</span>
                                    </div>
                                    <div>
                                        <span className="text-gray-500">Due:</span>
                                        <span className={`ml-2 font-medium ${selectedInvoice.status === 'overdue' ? 'text-red-600' : ''}`}>
                                            {selectedInvoice.due_date ? new Date(selectedInvoice.due_date).toLocaleDateString() : 'N/A'}
                                        </span>
                                    </div>
                                    <div className={`px-2 py-0.5 rounded-full text-xs ${getStatusColor(selectedInvoice.status)}`}>
                                        {getStatusLabel(selectedInvoice.status)}
                                    </div>
                                </div>

                                {/* Totals */}
                                <div className="flex justify-end mb-6">
                                    <div className="w-72 space-y-2">
                                        <div className="flex justify-between text-gray-600">
                                            <span>Subtotal</span>
                                            <span>₹{(selectedInvoice.subtotal || 0).toLocaleString('en-IN')}</span>
                                        </div>
                                        <div className="flex justify-between text-gray-600">
                                            <span>Platform Fee (2%)</span>
                                            <span>₹{(selectedInvoice.platform_fee || 0).toLocaleString('en-IN')}</span>
                                        </div>
                                        <div className="border-t pt-2 mt-2">
                                            <div className="flex justify-between text-xl font-bold text-gray-900">
                                                <span>Total</span>
                                                <span>₹{(selectedInvoice.total || 0).toLocaleString('en-IN')}</span>
                                            </div>
                                        </div>
                                        {selectedInvoice.paid_amount > 0 && (
                                            <>
                                                <div className="flex justify-between text-green-600">
                                                    <span>Paid</span>
                                                    <span>- ₹{(selectedInvoice.paid_amount || 0).toLocaleString('en-IN')}</span>
                                                </div>
                                                <div className="flex justify-between font-semibold text-gray-900">
                                                    <span>Balance Due</span>
                                                    <span>₹{((selectedInvoice.total || 0) - (selectedInvoice.paid_amount || 0)).toLocaleString('en-IN')}</span>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex justify-end gap-3 pt-4 border-t">
                                    {selectedInvoice.status === 'draft' && (
                                        <Button onClick={handleSendInvoice} disabled={sending} className="bg-indigo-600 hover:bg-indigo-700">
                                            <Send className="w-4 h-4 mr-2" />
                                            {sending ? 'Sending...' : 'Send Invoice'}
                                        </Button>
                                    )}
                                    {(selectedInvoice.status === 'sent' || selectedInvoice.status === 'overdue') && (
                                        <>
                                            <Button variant="outline" onClick={handleSendInvoice} disabled={sending}>
                                                <Send className="w-4 h-4 mr-2" />
                                                {sending ? 'Sending...' : 'Send Reminder'}
                                            </Button>
                                            <Button onClick={handleMarkPaid} className="bg-green-600 hover:bg-green-700">
                                                <CheckCircle2 className="w-4 h-4 mr-2" />
                                                Mark as Paid
                                            </Button>
                                        </>
                                    )}
                                    {selectedInvoice.status === 'paid' && (
                                        <div className="flex items-center gap-2 text-green-600">
                                            <CheckCircle2 className="w-5 h-5" />
                                            <span className="font-medium">Paid on {selectedInvoice.paid_at ? new Date(selectedInvoice.paid_at).toLocaleDateString() : 'N/A'}</span>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    ) : (
                        <Card className="h-full flex items-center justify-center min-h-[500px]">
                            <div className="text-center text-gray-500">
                                <Receipt className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                                <p>Select an invoice to view details</p>
                            </div>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    )
}

// ============================================================================
// CREATE INVOICE DIALOG
// ============================================================================

function CreateInvoiceDialog({
    onClose,
    onCreated
}: {
    onClose: () => void
    onCreated: () => void
}) {
    const [events, setEvents] = useState<{ id: string; name: string; client_name?: string; client_email?: string; date?: string }[]>([])
    const [selectedEventId, setSelectedEventId] = useState('')
    const [clientName, setClientName] = useState('')
    const [clientEmail, setClientEmail] = useState('')
    const [dueDate, setDueDate] = useState('')
    const [items, setItems] = useState<{ description: string; quantity: number; rate: number }[]>([
        { description: '', quantity: 1, rate: 0 }
    ])
    const [loadingEvents, setLoadingEvents] = useState(true)
    const [creating, setCreating] = useState(false)

    useEffect(() => {
        loadEvents()
    }, [])

    useEffect(() => {
        if (selectedEventId) {
            loadVendorItems(selectedEventId)
        }
    }, [selectedEventId])

    const loadEvents = async () => {
        const supabase = createClient()
        const { data } = await supabase
            .from('events')
            .select('id, name, client_name, client_email, date')
            .order('created_at', { ascending: false })
        setEvents(data || [])
        if (data && data.length > 0) {
            setSelectedEventId(data[0].id)
            setClientName(data[0].client_name || '')
            setClientEmail(data[0].client_email || '')
        }
        setLoadingEvents(false)
    }

    const loadVendorItems = async (eventId: string) => {
        const supabase = createClient()
        const { data: bookings } = await supabase
            .from('booking_requests')
            .select('service, budget, quoted_amount, vendors(company_name)')
            .eq('event_id', eventId)
            .in('status', ['accepted', 'confirmed'])

        if (bookings && bookings.length > 0) {
            interface BookingJoin { service?: string; budget?: number; quoted_amount?: number; vendors?: { company_name?: string } | { company_name?: string }[] | null }
            const autoItems = (bookings as BookingJoin[]).map((b) => {
                const vendor = Array.isArray(b.vendors) ? b.vendors[0] : b.vendors
                return {
                    description: `${vendor?.company_name || 'Vendor'} — ${b.service || 'Service'}`,
                    quantity: 1,
                    rate: b.quoted_amount || b.budget || 0
                }
            })
            setItems(autoItems)
        }

        // Auto-fill client info from event
        const evt = events.find(e => e.id === eventId)
        if (evt) {
            if (evt.client_name) setClientName(evt.client_name)
            if (evt.client_email) setClientEmail(evt.client_email)
        }
    }

    const addItem = () => setItems([...items, { description: '', quantity: 1, rate: 0 }])
    const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx))
    const updateItem = (idx: number, field: keyof typeof items[number], value: string | number) => {
        const updated = [...items]
        updated[idx] = { ...updated[idx], [field]: value }
        setItems(updated)
    }

    const subtotal = items.reduce((sum, i) => sum + (i.quantity * i.rate), 0)

    const handleSubmit = async () => {
        if (!selectedEventId || !clientName.trim() || items.length === 0) {
            toast.error('Event, client name, and at least one item are required')
            return
        }

        setCreating(true)
        const result = await createInvoice({
            eventId: selectedEventId,
            clientName: clientName.trim(),
            clientEmail: clientEmail.trim(),
            dueDate: dueDate || undefined,
            items: items.filter(i => i.description.trim()),
        })

        if (result.error) {
            toast.error(result.error)
        } else {
            toast.success('Invoice created!')
            onCreated()
        }
        setCreating(false)
    }

    if (loadingEvents) {
        return (
            <Card className="border-indigo-200">
                <CardContent className="p-6 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                </CardContent>
            </Card>
        )
    }

    return (
        <Card className="border-indigo-200 shadow-lg">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-lg">Create Invoice</CardTitle>
                <Button variant="ghost" size="icon" onClick={onClose}>
                    <X className="w-4 h-4" />
                </Button>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label className="text-sm font-medium text-gray-700 mb-1 block">Event *</label>
                        <select
                            className="w-full border rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-200 outline-none"
                            value={selectedEventId}
                            onChange={e => setSelectedEventId(e.target.value)}
                        >
                            {events.map(evt => (
                                <option key={evt.id} value={evt.id}>{evt.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-700 mb-1 block">Client Name *</label>
                        <Input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Client name" />
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-700 mb-1 block">Client Email</label>
                        <Input value={clientEmail} onChange={e => setClientEmail(e.target.value)} placeholder="client@email.com" />
                    </div>
                    <div>
                        <label className="text-sm font-medium text-gray-700 mb-1 block">Due Date</label>
                        <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                    </div>
                </div>

                {/* Line Items */}
                <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-medium text-gray-700">Line Items</label>
                        <Button variant="outline" size="sm" onClick={addItem}>
                            <Plus className="w-3 h-3 mr-1" /> Add Item
                        </Button>
                    </div>
                    <div className="space-y-2">
                        {items.map((item, idx) => (
                            <div key={idx} className="flex flex-wrap md:flex-nowrap gap-2 items-center">
                                <Input
                                    className="flex-1 min-w-[220px]"
                                    value={item.description}
                                    onChange={e => updateItem(idx, 'description', e.target.value)}
                                    placeholder="Description"
                                />
                                <Input
                                    className="w-20"
                                    type="number"
                                    value={item.quantity}
                                    onChange={e => updateItem(idx, 'quantity', Number(e.target.value))}
                                    placeholder="Qty"
                                />
                                <Input
                                    className="w-28"
                                    type="number"
                                    value={item.rate}
                                    onChange={e => updateItem(idx, 'rate', Number(e.target.value))}
                                    placeholder="Rate (₹)"
                                />
                                <span className="text-sm font-medium w-24 text-right">
                                    ₹{(item.quantity * item.rate).toLocaleString('en-IN')}
                                </span>
                                {items.length > 1 && (
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeItem(idx)}>
                                        <Trash2 className="w-3 h-3 text-red-500" />
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                    <div className="flex justify-end mt-2 text-sm font-semibold">
                        Subtotal: ₹{subtotal.toLocaleString('en-IN')}
                    </div>
                </div>

                <div className="flex justify-end gap-3">
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button
                        className="bg-indigo-600 hover:bg-indigo-700"
                        onClick={handleSubmit}
                        disabled={creating || !clientName.trim() || !selectedEventId}
                    >
                        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Invoice'}
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}

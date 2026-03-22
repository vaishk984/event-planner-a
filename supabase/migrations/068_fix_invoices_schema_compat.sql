-- Normalize invoices schema so createInvoice works on both fresh and legacy databases
-- Legacy DBs may still have invoices(amount, type, status='pending') from early migrations.

-- Ensure modern columns exist.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS planner_id UUID REFERENCES auth.users(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_number TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_name TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_email TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_phone TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS subtotal NUMERIC DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS platform_fee NUMERIC DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS total NUMERIC DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_amount NUMERIC DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Backfill planner_id from events when possible.
UPDATE invoices i
SET planner_id = e.planner_id
FROM events e
WHERE i.event_id = e.id
  AND i.planner_id IS NULL;

-- Backfill modern totals from legacy amount values.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'amount'
  ) THEN
    UPDATE invoices
    SET subtotal = COALESCE(subtotal, amount, 0),
        total = COALESCE(total, amount, 0)
    WHERE COALESCE(subtotal, 0) = 0 AND COALESCE(total, 0) = 0;

    EXECUTE 'ALTER TABLE invoices ALTER COLUMN amount DROP NOT NULL';
    EXECUTE 'ALTER TABLE invoices ALTER COLUMN amount SET DEFAULT 0';
  END IF;
END $$;

-- Legacy schemas require type; relax and default it so modern inserts work.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'type'
  ) THEN
    EXECUTE 'ALTER TABLE invoices ALTER COLUMN type DROP NOT NULL';
    EXECUTE 'ALTER TABLE invoices ALTER COLUMN type SET DEFAULT ''service''';
  END IF;
END $$;

-- Normalize status values and defaults for planner UI.
UPDATE invoices
SET status = 'draft'
WHERE status = 'pending' OR status IS NULL;

ALTER TABLE invoices ALTER COLUMN status SET DEFAULT 'draft';

-- Ensure required planner fields are always present for new records.
UPDATE invoices SET invoice_number = COALESCE(invoice_number, 'INV-LEGACY') WHERE invoice_number IS NULL;
UPDATE invoices SET client_name = COALESCE(client_name, 'Client') WHERE client_name IS NULL;

ALTER TABLE invoices ALTER COLUMN invoice_number SET NOT NULL;
ALTER TABLE invoices ALTER COLUMN client_name SET NOT NULL;

-- Refresh invoice_items structure for environments that may have legacy shapes.
CREATE TABLE IF NOT EXISTS invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    rate NUMERIC DEFAULT 0,
    amount NUMERIC DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Make RLS policies deterministic regardless of prior migrations.
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Planners can manage their invoices" ON invoices;
DROP POLICY IF EXISTS "invoices_all" ON invoices;
CREATE POLICY "Planners can manage their invoices" ON invoices
    FOR ALL
    USING (auth.uid() = planner_id)
    WITH CHECK (auth.uid() = planner_id);

ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage invoice items" ON invoice_items;
CREATE POLICY "Users can manage invoice items" ON invoice_items
    FOR ALL
    USING (
      invoice_id IN (SELECT id FROM invoices WHERE planner_id = auth.uid())
    )
    WITH CHECK (
      invoice_id IN (SELECT id FROM invoices WHERE planner_id = auth.uid())
    );

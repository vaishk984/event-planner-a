import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import fs from 'fs'
config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || 'fail'
)

async function run() {
    const eventId = '1cb0aef6-29d2-4b87-bc13-a96e16abf487'
    const { data: requests } = await supabase.from('booking_requests').select('*').eq('event_id', eventId)
    const { data: assignments } = await supabase.from('vendor_assignments').select('*, vendor:vendor_id(id, company_name, category)').eq('event_id', eventId)

    fs.writeFileSync('proposal-debug.json', JSON.stringify({ requests, assignments }, null, 2))
}
run()

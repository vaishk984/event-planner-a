import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function run() {
    const { data: { users } } = await supabaseAdmin.auth.admin.listUsers()
    const planner = users.find(u => u.email === 'anubhav.kus12@gmail.com')
    if (!planner) { console.log('Planner not found'); return }

    // Generate JWT for planner to test RLS
    // We can't easily sign a JWT here. An easier way is to just look at the DB policies.
}
run()

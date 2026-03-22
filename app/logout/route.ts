import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
    const nextRouterPrefetch = request.headers.get('next-router-prefetch')
    const middlewarePrefetch = request.headers.get('x-middleware-prefetch')
    const purpose = request.headers.get('purpose') || request.headers.get('sec-purpose')

    // Never execute logout logic for framework prefetch requests.
    // Otherwise, simply rendering a /logout link in the viewport can sign the user out.
    if (nextRouterPrefetch || middlewarePrefetch || purpose?.toLowerCase().includes('prefetch')) {
        return new NextResponse(null, {
            status: 204,
            headers: {
                'Cache-Control': 'no-store',
            },
        })
    }

    const cookieStore = await cookies()

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) => {
                        cookieStore.set(name, value, options)
                    })
                },
            },
        }
    )

    // Sign out from Supabase
    await supabase.auth.signOut()

    // Clear all auth-related cookies
    const allCookies = cookieStore.getAll()
    for (const cookie of allCookies) {
        if (cookie.name.includes('supabase') || cookie.name === 'session') {
            cookieStore.delete(cookie.name)
        }
    }

    // Redirect to login
    return NextResponse.redirect(new URL('/login', request.url))
}

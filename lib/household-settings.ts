// /lib/household-settings.ts
// Client-safe constants about a household's own settings.
//
// Deliberately not in lib/household.ts: that module builds a service-role
// Supabase client at import time, so anything a browser bundle touches has to
// live somewhere it can't drag that along. Not in the setup page's actions.ts
// either — a 'use server' file may only export async functions.

/**
 * Longest `parser_instructions` a household can store.
 *
 * This text is pasted into the prompt for every email that arrives, so the cap
 * is about cost and focus, not storage: a long enough blob would be paid for
 * on every parse and start crowding out the email being read.
 */
export const INSTRUCTIONS_MAX = 1000;

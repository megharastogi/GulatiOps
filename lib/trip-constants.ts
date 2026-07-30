// Allowed values for trip_activities columns. These are plain `text` columns in
// Postgres (no CHECK constraint) — validity is enforced only here, shared between
// the MCP tools (AI-driven writes) and the dashboard server actions (UI-driven writes)
// so the two paths can't drift apart on what's a legal value.

export const ACTIVITY_SLOTS = ['morning', 'afternoon', 'evening'] as const;
export type ActivitySlot = (typeof ACTIVITY_SLOTS)[number];

export const ACTIVITY_TYPES = ['activity', 'restaurant', 'date_night_restaurant'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_PRIORITIES = ['primary', 'alternate_1', 'alternate_2'] as const;
export type ActivityPriority = (typeof ACTIVITY_PRIORITIES)[number];

export const ACTIVITY_STATUSES = ['planned', 'confirmed', 'completed', 'cancelled'] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

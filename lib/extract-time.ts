// Pulls a clock time like "11:00 AM" or "2:00 PM" out of free text.
// Used as a fallback when a caller (chat-driven or otherwise) writes the
// time into a name/reservation_info string instead of the structured
// start_time field — narrow pattern (requires an explicit AM/PM marker)
// to keep false positives (e.g. "2 guests") out.
export function extractTimeFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(/\b(\d{1,2}):(\d{2})\s*([AaPp])\.?\s?[Mm]\.?\b/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 1 || hour > 12 || minute > 59) return null;

  let h24 = hour % 12;
  if (match[3].toUpperCase() === 'P') h24 += 12;

  return `${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

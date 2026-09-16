// /lib/members.ts
// The children of a household, and the one piece of arithmetic they need.

/** A child as the setup form knows them. `id` is absent until first saved. */
export type Kid = {
  id?: string;
  name: string;
  school: string | null;
  grade: string | null;
  birthdate: string | null; // YYYY-MM-DD
};

/** Suggestions only — the field is free text, so "Year 3" still works. */
export const GRADES = [
  'Pre-K',
  'TK',
  'Kindergarten',
  '1st',
  '2nd',
  '3rd',
  '4th',
  '5th',
  '6th',
  '7th',
  '8th',
  '9th',
  '10th',
  '11th',
  '12th',
];

/**
 * Whole years old on `on`, both dates as YYYY-MM-DD. Null if either date is
 * unparseable or the result is nonsense.
 *
 * Age is never stored anywhere — this is why. A number typed into the setup
 * form is wrong from the child's next birthday onwards, and it goes into the
 * email parser's prompt as a stated fact about the family, so it has to be
 * computed fresh each time it's used.
 *
 * Compares the date parts as integers instead of building Date objects:
 * `new Date('2019-03-04')` is parsed as UTC midnight and then read back in
 * local time, which puts the answer a day out west of Greenwich — exactly
 * where this app runs.
 */
export function ageOn(birthdate: string, on: string): number | null {
  const born = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthdate);
  const today = /^(\d{4})-(\d{2})-(\d{2})/.exec(on);
  if (!born || !today) return null;

  const [by, bm, bd] = born.slice(1, 4).map(Number);
  const [ty, tm, td] = today.slice(1, 4).map(Number);

  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1; // birthday hasn't come round yet

  return age >= 0 && age < 130 ? age : null;
}

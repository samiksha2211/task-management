// Word limits for Action Plan and BO Remarks. The browser shows a live
// counter with the same rule; the server rejects anything longer. Text is
// never shortened.

export const WORD_LIMIT = 60;

/** Words separated by whitespace (several spaces or line breaks count once). */
export function countWords(text: string | null | undefined): number {
  const trimmed = (text ?? "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function withinWordLimit(text: string | null | undefined, limit = WORD_LIMIT): boolean {
  return countWords(text) <= limit;
}

export function wordLimitMessage(field: string, limit = WORD_LIMIT): string {
  return `${field} can be at most ${limit} words`;
}

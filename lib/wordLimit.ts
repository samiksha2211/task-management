// Word limits for Action Plan and BO Remarks (the server checks the same rule).

export const WORD_LIMIT = 60;
/** From this many words the counter turns amber. */
export const WORD_WARNING = 50;

/** Words separated by whitespace (several spaces or line breaks count once). */
export function countWords(text: string | null | undefined): number {
  const trimmed = (text ?? "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function overWordLimit(text: string | null | undefined, limit = WORD_LIMIT): boolean {
  return countWords(text) > limit;
}

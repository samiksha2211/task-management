// Word limits (the server checks the same rule).

/** Action Plan (DRM and BO) and BO Remarks: room for detailed railway updates. */
export const WORD_LIMIT = 300;
/** DRM Remarks. */
export const DRM_REMARK_LIMIT = 150;
/** From this share of the limit the counter turns amber. */
export const WORD_WARNING_SHARE = 0.9;

/** Words separated by whitespace (several spaces or line breaks count once). */
export function countWords(text: string | null | undefined): number {
  const trimmed = (text ?? "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function overWordLimit(text: string | null | undefined, limit = WORD_LIMIT): boolean {
  return countWords(text) > limit;
}

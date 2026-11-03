"use client";

import { WORD_LIMIT, WORD_WARNING_SHARE, countWords } from "@/lib/wordLimit";

/** Live "35/300 words" counter; amber near the limit, red above it. */
export default function WordCount({ text, limit = WORD_LIMIT }: { text: string; limit?: number }) {
  const words = countWords(text);
  const warning = Math.floor(limit * WORD_WARNING_SHARE);
  const state = words > limit ? "is-over" : words >= warning ? "is-near" : "";
  return (
    <span className={`word-count ${state}`} aria-live="polite">
      {words}/{limit} words
      {words > limit && ` — please shorten by ${words - limit} word${words - limit === 1 ? "" : "s"} to save`}
      {words <= limit && words >= warning && " — close to the limit"}
    </span>
  );
}

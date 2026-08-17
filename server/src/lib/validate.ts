import { z } from "zod";

export function validate<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const error = new Error(
      result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    );
    (error as Error & { status?: number }).status = 400;
    throw error;
  }
  return result.data as z.output<S>;
}

/**
 * Pure marker helpers for the -clarify trigger.
 * Kept free of Pi runtime imports so they are easy to unit test.
 */

/** Whole-token marker so words like "pre-clarify" are ignored. */
export const CLARIFY_MARKER_RE = /(?:^|\s)-clarify(?=\s|$|[.,;:!?…])/gi;

export function hasClarifyMarker(text: string): boolean {
	const trimmed = String(text ?? "").trim();
	if (trimmed === "-clarify") return true;
	CLARIFY_MARKER_RE.lastIndex = 0;
	return CLARIFY_MARKER_RE.test(String(text ?? ""));
}

/** Remove every -clarify marker and return the remaining prompt text. */
export function stripClarifyMarker(text: string): string {
	return String(text ?? "")
		.replace(CLARIFY_MARKER_RE, " ")
		.replace(/\s+([.,;:!?…])/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
}

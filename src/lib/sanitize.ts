/**
 * Input sanitization — the "clean everything the user typed" layer of Aria.
 *
 * Applied server-side before user input is persisted (commit messages, repo
 * paths, branch names, share codes, AI instructions, search queries) and
 * before it is shown back in listings. The goal is not to mangle legitimate
 * content (file contents are the user's data and pass through untouched
 * beyond size caps — the secret scanner guards what gets committed) but to
 * strip the dangerous/control characters and traversal tricks that would
 * otherwise be echoed straight into another user's screen or into paths we
 * hand to GitHub.
 */

/** Strip control characters (except tab/newline/CR), trim, and cap length. */
export function cleanText(input: string, max = 2000): string {
  return input
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

/** Like cleanText but preserves interior newlines (commit messages, AI input). */
export function cleanMultiline(input: string, max = 20000): string {
  return input
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

/**
 * Clean a repository-relative file path: normalize backslashes, reject
 * traversal (..), absolute paths, and null/control bytes. Returns "" for
 * anything that doesn't survive — callers should treat "" as invalid.
 */
export function cleanPath(path: string, max = 1000): string {
  const cleaned = cleanText(path.replace(/\\/g, "/"), max);
  if (!cleaned) return "";
  if (cleaned.startsWith("/")) return "";
  const segments = cleaned.split("/");
  for (const segment of segments) {
    if (segment === ".." || segment === "." || segment.includes("\u0000")) {
      return "";
    }
  }
  return cleaned;
}

/** Clean a branch or repo full-name ("owner/repo"). */
export function cleanName(name: string, max = 200): string {
  return cleanText(name, max).replace(/\s+/g, "-");
}

/** Clean a search query (single line, short). */
export function cleanSearchQuery(query: string, max = 200): string {
  return cleanText(query, max);
}

/** Clean a free-form label/device name shown in presence lists. */
export function cleanLabel(label: string, max = 120): string {
  return cleanText(label, max);
}

/** Clean a short join code — uppercase, no control chars. */
export function cleanCode(code: string, max = 40): string {
  return cleanText(code, max).toUpperCase();
}

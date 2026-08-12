/**
 * Secret guardrails — the "trust" layer of Aria.
 *
 * Shared by the Convex actions (hard enforcement: refuse the commit unless the
 * user explicitly confirms) and the Dashboard (soft warnings before staging).
 * The goal is not to catch every leak — no scanner can — but to stop the
 * embarrassingly common ones: .env files, private keys, and well-known live
 * token formats that would otherwise be committed in one keystroke.
 */

const SECRET_FILENAME_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /(^|\/)\.env(\.[a-z0-9_-]+)?$/i, label: "environment file (.env)" },
  { re: /(^|\/)\.env\.example$/i, label: "environment file (.env.example)" },
  { re: /(^|\/)id_rsa$/i, label: "SSH private key (id_rsa)" },
  { re: /(^|\/)id_ed25519$/i, label: "SSH private key (id_ed25519)" },
  { re: /(^|\/)id_dsa$/i, label: "SSH private key (id_dsa)" },
  { re: /(^|\/)id_ecdsa$/i, label: "SSH private key (id_ecdsa)" },
  { re: /(^|\/).*\.pem$/i, label: "PEM certificate/key (.pem)" },
  { re: /(^|\/).*\.p12$/i, label: "PKCS#12 keystore (.p12)" },
  { re: /(^|\/).*\.pfx$/i, label: "PKCS#12 keystore (.pfx)" },
  { re: /(^|\/).*\.p8$/i, label: "private key (.p8)" },
  { re: /(^|\/).*\.key$/i, label: "key file (.key)" },
  { re: /(^|\/)(secrets?|credentials|service-account[^/]*)\.(json|ya?ml|toml|ini|env|txt)$/i, label: "credentials file" },
];

const SECRET_CONTENT_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /-----BEGIN (RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/, label: "private key block" },
  { re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, label: "AWS access key ID" },
  { re: /sk_live_[0-9a-zA-Z]{16,}/, label: "Stripe live secret key" },
  { re: /rk_live_[0-9a-zA-Z]{16,}/, label: "Stripe live restricted key" },
  { re: /\bghp_[0-9A-Za-z]{36,}\b/, label: "GitHub personal access token" },
  { re: /\bgithub_pat_[0-9A-Za-z_]{20,}\b/, label: "GitHub fine-grained token" },
  { re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/, label: "Slack token" },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/, label: "Google API key" },
  { re: /\bsk-[0-9A-Za-z]{20,}\b/, label: "OpenAI-style secret key" },
];

export interface SecretRisk {
  risky: boolean;
  reasons: string[];
}

/** Check a file path + content for likely secrets. */
export function secretRisk(path: string, content: string): SecretRisk {
  const reasons: string[] = [];
  for (const p of SECRET_FILENAME_PATTERNS) {
    if (p.re.test(path)) {
      reasons.push(`filename looks like ${p.label}`);
      break;
    }
  }
  for (const p of SECRET_CONTENT_PATTERNS) {
    if (p.re.test(content)) {
      reasons.push(`content contains ${p.label}`);
      break;
    }
  }
  return { risky: reasons.length > 0, reasons };
}

/** True when any of the given files trips the secret guard. */
export function anySecretRisk(
  files: Array<{ path: string; content: string }>,
): { risky: boolean; files: string[] } {
  const flagged: string[] = [];
  for (const file of files) {
    const risk = secretRisk(file.path, file.content);
    if (risk.risky) flagged.push(file.path);
  }
  return { risky: flagged.length > 0, files: flagged };
}

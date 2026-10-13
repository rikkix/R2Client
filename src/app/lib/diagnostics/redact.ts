/** Scrub credentials from optional local diagnostic output. */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // AWS-style access key IDs (AKIA…, ASIA…).
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[redacted-key-id]'],
  // Authorization header values.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+\/=]{8,}/g, '$1 [redacted]'],
  // Presigned-URL credential and signature parameters.
  [/([?&](?:X-Amz-Credential|X-Amz-Signature|X-Amz-Security-Token)=)[^&\s]+/gi, '$1[redacted]'],
  // Scalar values of secret-shaped keys, in JSON or key=value form —
  // `"secret_access_key":"…"`, `secretAccessKey: …`, `password=…`, `"api_token":"…"`.
  // The key may carry a prefix (`client_secret`, `refresh_token`, `accessToken`);
  // the separator must follow the secret word at once, so `tokenId: 3` is not a
  // hit, and a nested object (`"token":{…}`) is not a value and is left alone.
  // The prefix is bounded: unbounded, every hyphen in a long run opens a new
  // start position that rescans the rest, and the scan turns quadratic.
  [
    /\b([A-Za-z0-9_-]{0,40}(?:secret|password|passwd|pwd|token|(?:api|access|private|secret)[_-]?key))(["']?\s*[:=]\s*["']?)(?![{[])[^\s"',}\]]+/gi,
    '$1$2[redacted]',
  ],
  // Long hex runs: key IDs, secrets, signatures, account IDs.
  [/\b[0-9a-f]{32,}\b/gi, '[redacted-hex]'],
  // Exactly-40-character tokens: Cloudflare API tokens and AWS secret access
  // keys are both this long. Slashes are excluded so a path of object keys can
  // never match; a bare 40-character file name would, and losing it costs nothing.
  [/(?<![A-Za-z0-9/+=_-])[A-Za-z0-9+=_-]{40}(?![A-Za-z0-9/+=_-])/g, '[redacted-token]'],
];

export const redactSecrets = (text: string): string =>
  RULES.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);

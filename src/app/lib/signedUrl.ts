export function validateSignedUrlLifetime(seconds: number): number {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 604800)
    throw new Error('Choose a lifetime between 1 second and 7 days');
  return seconds;
}

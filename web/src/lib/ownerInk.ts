/** Stable print ink for each owner, shared by directory and profile. */
export function ownerInk(id: string): string {
  const inks = ["#193b48", "#324c42", "#603d46", "#3d4059", "#624830"];
  const hash = Array.from(id).reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
  return inks[hash % inks.length];
}

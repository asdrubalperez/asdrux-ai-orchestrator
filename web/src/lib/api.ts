export function apiUrl(path: string): string {
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (!baseUrl) return path;
  return new URL(path, baseUrl).toString();
}

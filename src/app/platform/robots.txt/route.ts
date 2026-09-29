/** Platform host robots.txt: marketing pages are public, the dashboard is not. */
export function GET() {
  const body = ["User-agent: *", "Disallow: /dashboard", "Disallow: /api", "Disallow: /admin", ""].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

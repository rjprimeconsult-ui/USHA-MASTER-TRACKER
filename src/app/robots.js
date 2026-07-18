// App Router robots route. Crawlers are pointed at the marketing (brand) host;
// the app subdomain is additionally noindex'd via an X-Robots-Tag header in
// middleware, so the app/login is not indexed even though this file allows /.
export default function robots() {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin'] }],
    host: 'https://www.primtracker.com',
  };
}

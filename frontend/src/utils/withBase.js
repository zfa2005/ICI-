// Builds a URL for a static asset (in public/) that works whether the app is
// deployed at a domain root or under a GitHub Pages project subpath.
export function withBase(path) {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    return `${base}/${path.replace(/^\//, '')}`;
}

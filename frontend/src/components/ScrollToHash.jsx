import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// React Router doesn't scroll to #anchors on navigation by default (there's
// no real page load). This restores that behaviour for both same-page
// (#why-ici) and cross-page (/#why-ici from another route) hash links.
export default function ScrollToHash() {
    const location = useLocation();

    useEffect(() => {
        if (location.hash) {
            const id = location.hash.slice(1);
            // Give the destination page a tick to mount before measuring it.
            const raf = requestAnimationFrame(() => {
                document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
            });
            return () => cancelAnimationFrame(raf);
        }
        window.scrollTo(0, 0);
    }, [location.pathname, location.hash]);

    return null;
}

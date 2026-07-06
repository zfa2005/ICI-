import { useEffect } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import useNavbarScroll from '../hooks/useNavbarScroll';
import { withBase } from '../utils/withBase';

const HASH_LINKS = ['why-ici', 'features', 'who-we-serve'];

export default function Nav() {
    const scrolled = useNavbarScroll();
    const location = useLocation();
    const onHome = location.pathname === '/';

    // Highlight whichever hash-section is currently in view, but only on the
    // home page where those sections actually exist.
    useEffect(() => {
        if (!onHome) return;
        const sections = HASH_LINKS
            .map(id => document.getElementById(id))
            .filter(Boolean);
        if (!sections.length) return;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    document.querySelectorAll('.nav-link[data-hash]').forEach(link => {
                        link.classList.toggle('active', link.dataset.hash === entry.target.id);
                    });
                }
            });
        }, { rootMargin: '-40% 0px -55% 0px' });

        sections.forEach(s => observer.observe(s));
        return () => observer.disconnect();
    }, [onHome]);

    return (
        <nav className={`navbar${scrolled ? ' scrolled' : ''}`} id="navbar">
            <div className="nav-inner">
                <Link to="/" className="nav-logo">
                    <span className="nav-logo-text">Immigrant Climate Index</span>
                </Link>

                <div className="nav-links">
                    <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>Home</NavLink>
                    <Link to="/#why-ici" className="nav-link" data-hash="why-ici">Why ICI</Link>
                    <Link to="/#features" className="nav-link" data-hash="features">Features</Link>
                    <Link to="/#who-we-serve" className="nav-link" data-hash="who-we-serve">Who We Serve</Link>
                    <NavLink to="/team" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>Team</NavLink>
                    <NavLink to="/contact" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>Contact</NavLink>

                    <div className="nav-dropdown">
                        <button className="nav-dropdown-btn">
                            Research <span className="chevron">▾</span>
                        </button>
                        <div className="nav-dropdown-menu">
                            <a href={withBase('research.html')} className="dropdown-item">
                                <div className="dropdown-item-icon" style={{ background: 'rgba(99,102,241,0.12)', color: '#818CF8' }}>PUB</div>
                                <div className="dropdown-item-text">
                                    <div className="title">Research Publication</div>
                                    <div className="sub">Full academic paper &amp; methodology</div>
                                </div>
                            </a>
                            <Link to="/assistant" className="dropdown-item">
                                <div className="dropdown-item-icon" style={{ background: 'rgba(245,158,11,0.12)', color: '#F59E0B' }}>AI</div>
                                <div className="dropdown-item-text">
                                    <div className="title">AI Research Assistant</div>
                                    <div className="sub">Natural-language database queries</div>
                                </div>
                            </Link>
                        </div>
                    </div>
                </div>

                <div className="nav-right">
                    <a href="#" className="btn-ghost">Log in</a>
                    <a href="#" className="btn-primary">Sign up</a>
                </div>
            </div>
        </nav>
    );
}

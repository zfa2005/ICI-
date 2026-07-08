import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import useNavbarScroll from '../hooks/useNavbarScroll';
import { withBase } from '../utils/withBase';

const HASH_LINKS = ['why-ici', 'features', 'who-we-serve'];

export default function Nav() {
    const scrolled = useNavbarScroll();
    const location = useLocation();
    const onHome = location.pathname === '/';
    const [menuOpen, setMenuOpen] = useState(false);

    // Close the mobile menu whenever navigation happens.
    useEffect(() => { setMenuOpen(false); }, [location.pathname, location.hash]);

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

    const close = () => setMenuOpen(false);

    return (
        <nav className={`navbar${scrolled || menuOpen ? ' scrolled' : ''}`} id="navbar">
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
                    <NavLink to="/contact" className={({ isActive }) => `btn-contact${isActive ? ' active' : ''}`}>Contact Us</NavLink>
                </div>

                <button
                    className={`nav-burger${menuOpen ? ' open' : ''}`}
                    aria-label="Toggle navigation menu"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen(o => !o)}
                >
                    <span /><span /><span />
                </button>
            </div>

            <div className={`nav-mobile-menu${menuOpen ? ' open' : ''}`}>
                <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : undefined} onClick={close}>Home</NavLink>
                <Link to="/#why-ici" onClick={close}>Why ICI</Link>
                <Link to="/#features" onClick={close}>Features</Link>
                <Link to="/#who-we-serve" onClick={close}>Who We Serve</Link>
                <NavLink to="/team" className={({ isActive }) => isActive ? 'active' : undefined} onClick={close}>Team</NavLink>
                <NavLink to="/contact" className={({ isActive }) => isActive ? 'active' : undefined} onClick={close}>Contact</NavLink>
                <div className="menu-section">Research</div>
                <a href={withBase('research.html')} onClick={close}>Research Publication</a>
                <NavLink to="/assistant" className={({ isActive }) => isActive ? 'active' : undefined} onClick={close}>AI Research Assistant</NavLink>
            </div>
        </nav>
    );
}

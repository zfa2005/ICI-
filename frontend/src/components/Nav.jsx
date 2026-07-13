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
    const [activeSection, setActiveSection] = useState(null);
    const [researchOpen, setResearchOpen] = useState(false);

    // Close the mobile menu whenever navigation happens.
    useEffect(() => { setMenuOpen(false); }, [location.pathname, location.hash]);

    // Highlight whichever hash-section is currently in view, but only on the
    // home page where those sections actually exist. The active section lives
    // in React state so it is the single source of truth for link styling:
    // it clears when no section is in view (back at the hero) and when
    // navigating to another page.
    useEffect(() => {
        if (!onHome) { setActiveSection(null); return; }
        const sections = HASH_LINKS
            .map(id => document.getElementById(id))
            .filter(Boolean);
        if (!sections.length) return;

        const visible = new Set();
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) visible.add(entry.target.id);
                else visible.delete(entry.target.id);
            });
            setActiveSection(HASH_LINKS.find(id => visible.has(id)) ?? null);
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
                    <NavLink to="/" end className={({ isActive }) => `nav-link${isActive && !activeSection ? ' active' : ''}`}>Home</NavLink>
                    <Link to="/#why-ici" className={`nav-link${activeSection === 'why-ici' ? ' active' : ''}`}>Why ICI</Link>
                    <Link to="/#features" className={`nav-link${activeSection === 'features' ? ' active' : ''}`}>Features</Link>
                    <Link to="/#who-we-serve" className={`nav-link${activeSection === 'who-we-serve' ? ' active' : ''}`}>Who We Serve</Link>
                    <NavLink to="/team" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>Team</NavLink>

                    <div
                        className="nav-dropdown"
                        onMouseEnter={() => setResearchOpen(true)}
                        onMouseLeave={() => setResearchOpen(false)}
                        onFocus={() => setResearchOpen(true)}
                        onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setResearchOpen(false); }}
                    >
                        <button className="nav-dropdown-btn" aria-haspopup="true" aria-expanded={researchOpen}>
                            Research <span className="chevron">▾</span>
                        </button>
                        <div className="nav-dropdown-menu">
                            <a href={withBase('research.html')} className="dropdown-item">
                                <div className="dropdown-item-text">
                                    <div className="title">Research Publication</div>
                                    <div className="sub">Full academic paper &amp; methodology</div>
                                </div>
                            </a>
                            <Link to="/assistant" className="dropdown-item">
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

import { Link } from 'react-router-dom';
import { withBase } from '../utils/withBase';

export default function Footer() {
    return (
        <footer>
            <div className="container">
                <div className="footer-inner">
                    <div className="footer-brand">
                        <Link to="/" className="nav-logo">
                            <span className="nav-logo-text">Immigrant Climate Index</span>
                        </Link>
                        <p>A quantitative measure of the regulatory climate for immigrants across all U.S. jurisdictions — from federal policy to local ordinance.</p>
                        <p style={{ fontSize: '0.73rem', color: '#52525B' }}>
                            © 2024 Huyen Pham &amp; Pham Hoang Van.<br />
                            Texas A&amp;M University School of Law &amp; Baylor University.
                        </p>
                    </div>

                    <div className="footer-col">
                        <h4>Platform</h4>
                        <Link to="/assistant">AI Research Assistant</Link>
                        <a href={withBase('research.html')}>Research Paper</a>
                    </div>

                    <div className="footer-col">
                        <h4>Navigate</h4>
                        <Link to="/#why-ici">Why ICI</Link>
                        <Link to="/#features">Features</Link>
                        <Link to="/#who-we-serve">Who We Serve</Link>
                        <Link to="/team">Team</Link>
                        <Link to="/contact">Contact</Link>
                    </div>

                    <div className="footer-col">
                        <h4>Authors</h4>
                        <a href="https://www.law.tamu.edu/" target="_blank" rel="noreferrer">Texas A&amp;M School of Law</a>
                        <a href="https://hankamer.baylor.edu/economics" target="_blank" rel="noreferrer">Baylor Economics</a>
                        <a href="https://hankamer.baylor.edu/person/van-h-pham" target="_blank" rel="noreferrer">Prof. Van H. Pham</a>
                    </div>
                </div>

                <div className="footer-bottom">
                    <p>Built for open academic research. Database covers 2005–2026.</p>
                    <div className="footer-bottom-links">
                        <a href={withBase('research.html')}>Research</a>
                        <Link to="/assistant">AI Chat</Link>
                        <Link to="/">Home</Link>
                    </div>
                </div>
            </div>
        </footer>
    );
}

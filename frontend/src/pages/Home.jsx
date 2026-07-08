import { Link } from 'react-router-dom';
import Reveal from '../components/Reveal';
import StatCounter from '../components/StatCounter';
import { withBase } from '../utils/withBase';
import './Home.css';

export default function Home() {
    return (
        <>
            {/* ── HERO ── */}
            <section className="hero">
                <div className="hero-orb hero-orb-1" />
                <div className="hero-orb hero-orb-2" />
                <div className="hero-orb hero-orb-3" />
                <div className="container hero-inner">
                    <div className="hero-badge">
                        <span className="hero-badge-dot" />
                        Academic Research &mdash; Texas A&amp;M Law &amp; Baylor University
                        <span className="hero-badge-sep" />
                        Open Access Database
                    </div>

                    <h1>
                        Measuring America's<br />
                        <span className="gradient-text">Immigration Climate</span>
                    </h1>

                    <p className="hero-sub">
                        The first quantitative index measuring the regulation-induced climate
                        for immigrants across every U.S. jurisdiction — federal, state, county,
                        and city — through a rigorous tier-based scoring system.
                    </p>

                    <div className="hero-ctas">
                        <Link to="/assistant" className="btn-hero-primary">
                            Try the AI Assistant →
                        </Link>
                        <a href={withBase('research.html')} className="btn-hero-secondary">
                            Read the Research
                        </a>
                    </div>

                    <div className="hero-stats">
                        <div className="hero-stat">
                            <StatCounter target={13524} />
                            <div className="hero-stat-label">Laws Catalogued</div>
                        </div>
                        <div className="hero-stat">
                            <StatCounter target={50} />
                            <div className="hero-stat-label">States + DC</div>
                        </div>
                        <div className="hero-stat">
                            <StatCounter target={21} suffix=" yrs" />
                            <div className="hero-stat-label">Coverage (2005–2026)</div>
                        </div>
                        <div className="hero-stat">
                            <StatCounter target={3491} />
                            <div className="hero-stat-label">287(g) Agreements</div>
                        </div>
                        <div className="hero-stat">
                            <StatCounter target={1000} suffix="+" />
                            <div className="hero-stat-label">Jurisdictions</div>
                        </div>
                    </div>

                    <div className="trust-bar">
                        <span className="trust-label">Research by</span>
                        <div className="trust-items">
                            <span className="trust-item">Texas A&amp;M University School of Law</span>
                            <span className="trust-item">Baylor University</span>
                            <span className="trust-item">Open Access</span>
                            <span className="trust-item">Peer Reviewed</span>
                            <span className="trust-item">2005 – 2026 Coverage</span>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── WHY ICI ── */}
            <section id="why-ici">
                <div className="container">
                    <Reveal as="div" className="section-head">
                        <div className="section-label">Why the ICI</div>
                        <h2>Immigration policy is fragmented.<br />We make it measurable.</h2>
                        <p>Before the ICI, researchers and policymakers had no systematic way to compare how welcoming — or hostile — different U.S. jurisdictions are to immigrants. We fixed that.</p>
                    </Reveal>

                    <div className="why-grid">
                        <Reveal className="why-card">
                            <div className="why-icon" style={{ background: 'rgba(99,102,241,0.12)', fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.04em', color: 'var(--accent-light)' }}>01</div>
                            <h3>A Fractured Landscape</h3>
                            <p>Immigration regulation happens at the federal level, but thousands of state, county, and city governments each pass their own laws affecting immigrants daily — creating a patchwork impossible to track manually.</p>
                        </Reveal>
                        <Reveal className="why-card" delay="0.1s">
                            <div className="why-icon" style={{ background: 'rgba(16,185,129,0.12)', fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.04em', color: '#10B981' }}>02</div>
                            <h3>Quantitative Rigor</h3>
                            <p>Every law in the database is assigned a tier score (±1 to ±4) based on the depth of its impact on immigrant life. Scores are aggregated into a single ICI score per jurisdiction — comparable across states and years.</p>
                        </Reveal>
                        <Reveal className="why-card" delay="0.2s">
                            <div className="why-icon" style={{ background: 'rgba(245,158,11,0.12)', fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.04em', color: '#F59E0B' }}>03</div>
                            <h3>The Trump Effect — Documented</h3>
                            <p>The ICI reveals a 10x spike in legislative activity starting in 2017 as state and local governments raced to pass sanctuary protections in response to federal immigration enforcement escalation.</p>
                        </Reveal>
                    </div>
                </div>
            </section>

            {/* ── FEATURES ── */}
            <section id="features">
                <div className="container">
                    <Reveal as="div" className="section-head">
                        <div className="section-label">Platform Features</div>
                        <h2>Research tools built for<br />how experts actually work</h2>
                        <p>From natural-language AI queries to raw CSV exports, the ICI platform meets researchers, lawyers, and policymakers wherever they are in their workflow.</p>
                    </Reveal>

                    <div className="features-grid">
                        <Reveal className="feature-card">
                            <div className="feature-icon" style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.04em', color: 'var(--accent-light)' }}>AI</div>
                            <h3>AI Research Assistant</h3>
                            <p>Ask any question in plain English. Claude Sonnet answers using live database statistics — not approximations from training data — and maintains context across a full conversation.</p>
                        </Reveal>
                        <Reveal className="feature-card" delay="0.08s">
                            <div className="feature-icon" style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.04em', color: 'var(--accent-light)' }}>VIZ</div>
                            <h3>Interactive Visualisations</h3>
                            <p>Time-series line charts, state-comparison bars, law-type breakdowns, and Trump-Effect analyses — all rendered live in the browser using Chart.js with a dark research aesthetic.</p>
                        </Reveal>
                        <Reveal className="feature-card" delay="0.24s">
                            <div className="feature-icon" style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.04em', color: 'var(--accent-light)' }}>CSV</div>
                            <h3>CSV Data Export</h3>
                            <p>Download any filtered result set as a standards-compliant CSV for use in Stata, R, Python, or Excel. Export the full database or just the 47 sanctuary laws passed in Illinois — your choice.</p>
                        </Reveal>
                        <Reveal className="feature-card" delay="0.32s">
                            <div className="feature-icon" style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.04em', color: 'var(--accent-light)' }}>LOG</div>
                            <h3>Persistent Chat History</h3>
                            <p>Every AI conversation is saved to a local SQLite database. Return tomorrow, pick up where you left off. Rename, delete, or search past sessions from the sidebar.</p>
                        </Reveal>
                        <Reveal className="feature-card" delay="0.4s">
                            <div className="feature-icon" style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.04em', color: 'var(--accent-light)' }}>ICI</div>
                            <h3>ICI Tier Scoring</h3>
                            <p>Each law is scored ±1 to ±4 based on how broadly it affects immigrant life. Scores are explained in plain language, traceable back to the original academic methodology paper.</p>
                        </Reveal>
                        <Reveal className="feature-card" delay="0.48s">
                            <div className="feature-icon" style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.04em', color: 'var(--positive)' }}>OA</div>
                            <h3>Open Access Database</h3>
                            <p>The full 13,524-law database is freely accessible with no paywall or sign-in. Built on open academic research and designed to support government, legal, and scholarly work at any scale.</p>
                        </Reveal>
                    </div>
                </div>
            </section>

            {/* ── WHO WE SERVE ── */}
            <section id="who-we-serve">
                <div className="container">
                    <Reveal as="div" className="section-head">
                        <div className="section-label">Who We Serve</div>
                        <h2>Built for the professionals<br />shaping immigration policy</h2>
                        <p>The ICI platform serves anyone who needs to understand the U.S. sub-federal immigration landscape quickly, accurately, and at scale.</p>
                    </Reveal>

                    <div className="serve-grid">
                        <Reveal className="serve-card">
                            <h3>Government &amp; Policy Makers</h3>
                            <p>Federal agencies, state legislatures, and local government offices tracking the national immigration regulatory environment for compliance, litigation, or policy development.</p>
                            <ul className="serve-list">
                                <li>DHS &amp; ICE enforcement analysts</li>
                                <li>State attorneys general offices</li>
                                <li>Congressional research staff</li>
                                <li>City &amp; county counsel offices</li>
                                <li>USCIS policy development teams</li>
                            </ul>
                        </Reveal>

                        <Reveal className="serve-card" delay="0.1s">
                            <h3>Immigration Law Firms</h3>
                            <p>Attorneys and paralegals who need instant answers on the regulatory climate in a specific jurisdiction before advising clients on relocation, enforcement risk, or compliance strategy.</p>
                            <ul className="serve-list">
                                <li>Sanctuary city &amp; detainer research</li>
                                <li>State-level employer obligations (E-Verify)</li>
                                <li>287(g) agreement status by county</li>
                                <li>Historical law searches for case strategy</li>
                                <li>Comparative jurisdiction analysis</li>
                            </ul>
                        </Reveal>

                        <Reveal className="serve-card" delay="0.2s">
                            <h3>Researchers &amp; Students</h3>
                            <p>Law review editors, economics PhD students, and public policy researchers studying the causes and effects of sub-federal immigration regulation at scale.</p>
                            <ul className="serve-list">
                                <li>Immigration law &amp; policy scholars</li>
                                <li>Labor economics researchers</li>
                                <li>Public policy &amp; sociology departments</li>
                                <li>Undergraduate &amp; JD thesis writers</li>
                                <li>Think tanks &amp; NGOs</li>
                            </ul>
                        </Reveal>
                    </div>
                </div>
            </section>

            {/* ── RESEARCH TOOLS — quick access cards ── */}
            <section id="tools">
                <div className="container">
                    <Reveal as="div" className="section-head">
                        <div className="section-label">Get Started</div>
                        <h2>Ask the data.<br />Read the research.</h2>
                        <p>Get instant answers from the AI assistant, or go deep with the published paper — both draw on the same 13,524-law database.</p>
                    </Reveal>

                    <div className="tools-grid">
                        <Reveal as={Link} to="/assistant" className="tool-card primary">
                            <div className="tool-card-label">Recommended</div>
                            <h3>AI Research Assistant</h3>
                            <p>Ask complex, multi-part questions about immigration trends, state comparisons, or the Trump Effect in natural language. Claude answers with real database numbers and keeps memory across the conversation.</p>
                            <span className="tool-card-arrow">AI Assistant →</span>
                        </Reveal>

                        <Reveal as="a" href={withBase('research.html')} className="tool-card secondary" delay="0.1s">
                            <div className="tool-card-label">Academic</div>
                            <h3>Research Paper</h3>
                            <p>Full methodology, figures, and findings from the original ICI publication by Pham &amp; Pham (2024).</p>
                            <span className="tool-card-arrow">Read Paper →</span>
                        </Reveal>
                    </div>
                </div>
            </section>

            {/* ── CTA ── */}
            <section id="cta">
                <div className="container cta-inner">
                    <Reveal>
                        <div className="section-label" style={{ margin: '0 auto 18px', display: 'table' }}>Start Exploring</div>
                        <h2>The data is open.<br /><span className="gradient-text">The research starts here.</span></h2>
                        <p>Every law in the ICI database is free to explore, filter, and export. No sign-in required for the data tools.</p>
                        <div className="cta-btns">
                            <Link to="/assistant" className="btn-hero-primary">AI Assistant →</Link>
                            <a href={withBase('research.html')} className="btn-hero-secondary">Research Paper</a>
                        </div>
                    </Reveal>
                </div>
            </section>
        </>
    );
}

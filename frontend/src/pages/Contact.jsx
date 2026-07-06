import { useState } from 'react';
import Reveal from '../components/Reveal';
import './Contact.css';

export default function Contact() {
    const [submitted, setSubmitted] = useState(false);

    function handleSubmit(e) {
        e.preventDefault();
        setSubmitted(true);
    }

    return (
        <>
            <div className="page-hero">
                <div className="container">
                    <div className="section-label">Get in Touch</div>
                    <h1>Request a demo or<br /><span className="gradient-text">send us an enquiry</span></h1>
                    <p>Interested in integrating the ICI into your research workflow, litigation strategy, or policy toolkit? The research team will get back to you within 2 business days.</p>
                </div>
            </div>

            <div className="contact-section">
                <div className="container">
                    <div className="contact-grid">
                        <Reveal>
                            <h2 className="contact-info">Who should reach out</h2>
                            <p className="contact-info">The ICI platform serves government agencies, law firms, and academic researchers. Tell us what you're working on and we'll find the best way to help.</p>
                            <ul className="contact-perks">
                                <li>
                                    <span className="perk-icon" style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.04em' }}>GOV</span>
                                    <span><strong style={{ color: 'var(--text)' }}>Government &amp; policy agencies</strong> — request a briefing on jurisdiction-level ICI scores</span>
                                </li>
                                <li>
                                    <span className="perk-icon" style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.04em' }}>LAW</span>
                                    <span><strong style={{ color: 'var(--text)' }}>Law firms</strong> — enquire about bulk data access or custom jurisdiction reports</span>
                                </li>
                                <li>
                                    <span className="perk-icon" style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.04em' }}>RES</span>
                                    <span><strong style={{ color: 'var(--text)' }}>Researchers &amp; universities</strong> — collaboration, citation, or dataset requests</span>
                                </li>
                                <li>
                                    <span className="perk-icon" style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.04em' }}>GEN</span>
                                    <span><strong style={{ color: 'var(--text)' }}>General enquiries</strong> — questions about the methodology, data coverage, or the ICI platform</span>
                                </li>
                            </ul>
                        </Reveal>

                        <Reveal delay="0.1s" className="contact-form-card">
                            {submitted ? (
                                <div className="form-success">
                                    <h3>Enquiry received</h3>
                                    <p>Thank you — the research team will be in touch within 2 business days.</p>
                                </div>
                            ) : (
                                <form onSubmit={handleSubmit} autoComplete="off">
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label htmlFor="cf-name">Full Name <span className="required">*</span></label>
                                            <input id="cf-name" type="text" className="form-control" placeholder="Jane Smith" required />
                                        </div>
                                        <div className="form-group">
                                            <label htmlFor="cf-company">Organisation / Company <span className="required">*</span></label>
                                            <input id="cf-company" type="text" className="form-control" placeholder="ACLU, DOJ, Smith &amp; Partners…" required />
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="cf-email">Official Email <span className="required">*</span></label>
                                        <input id="cf-email" type="email" className="form-control" placeholder="jane@organisation.org" required />
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="cf-enquiry">Enquiry <span className="required">*</span></label>
                                        <textarea id="cf-enquiry" className="form-control" placeholder="Tell us what you're working on, what data you need, or what you'd like to see in a demo…" required />
                                    </div>
                                    <button type="submit" className="form-submit">Send Enquiry →</button>
                                    <p className="form-note">We typically respond within 2 business days. Fields marked <span style={{ color: 'var(--negative)' }}>*</span> are required.</p>
                                </form>
                            )}
                        </Reveal>
                    </div>
                </div>
            </div>
        </>
    );
}

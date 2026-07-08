import { useState } from 'react';
import './Contact.css';

export default function Contact() {
    const [submitted, setSubmitted] = useState(false);

    function handleSubmit(e) {
        e.preventDefault();
        setSubmitted(true);
    }

    return (
        <div className="contact-hero">
            <div className="contact-orb contact-orb-1" />
            <div className="contact-orb contact-orb-2" />
            <div className="container">
                <div className="contact-hero-grid">

                    {/* Left — pitch, at the same level as the form */}
                    <div className="contact-hero-left">
                        <div className="section-label">Get in Touch</div>
                        <h1>Request a demo or<br /><span className="gradient-text">send us an enquiry</span></h1>
                        <p className="contact-lede">
                            Interested in integrating the ICI into your research workflow, litigation
                            strategy, or policy toolkit? The research team will get back to you within
                            2 business days.
                        </p>

                        <ul className="contact-perks">
                            <li>
                                <span className="perk-icon">GOV</span>
                                <span><strong>Government &amp; policy agencies</strong> — request a briefing on jurisdiction-level ICI scores</span>
                            </li>
                            <li>
                                <span className="perk-icon">LAW</span>
                                <span><strong>Law firms</strong> — enquire about bulk data access or custom jurisdiction reports</span>
                            </li>
                            <li>
                                <span className="perk-icon">RES</span>
                                <span><strong>Researchers &amp; universities</strong> — collaboration, citation, or dataset requests</span>
                            </li>
                            <li>
                                <span className="perk-icon">GEN</span>
                                <span><strong>General enquiries</strong> — questions about the methodology, data coverage, or the ICI platform</span>
                            </li>
                        </ul>

                        <div className="contact-trust">
                            <span className="contact-trust-dot" />
                            Typical response time: under 2 business days
                        </div>
                    </div>

                    {/* Right — the form, side by side with the pitch */}
                    <div className="contact-form-card">
                        {submitted ? (
                            <div className="form-success">
                                <h3>Enquiry received</h3>
                                <p>Thank you — the research team will be in touch within 2 business days.</p>
                            </div>
                        ) : (
                            <>
                                <div className="form-card-head">
                                    <h2>Request a demo</h2>
                                    <p>Tell us what you're working on — we'll tailor the walkthrough to your use case.</p>
                                </div>
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
                            </>
                        )}
                    </div>

                </div>
            </div>
        </div>
    );
}

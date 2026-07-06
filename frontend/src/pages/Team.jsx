import { useState } from 'react';
import Reveal from '../components/Reveal';
import './Team.css';

function TeamPhoto({ src, alt, initials, affiliation }) {
    const [errored, setErrored] = useState(false);
    return (
        <div className="team-photo-wrap">
            {errored ? (
                <div className="team-avatar">{initials}</div>
            ) : (
                <img src={src} alt={alt} onError={() => setErrored(true)} />
            )}
            <div className="team-photo-overlay" />
            <div className="team-affil">
                <div className="team-affil-dot" />
                <span className="team-affil-text">{affiliation}</span>
            </div>
        </div>
    );
}

export default function Team() {
    return (
        <>
            <div className="page-hero">
                <div className="container">
                    <div className="section-label">The Research Team</div>
                    <h1>Built by leading scholars in<br /><span className="gradient-text">law and economics</span></h1>
                    <p>The ICI is the product of a decade-long collaboration between an immigration law expert and a development economist — bridging legal analysis and quantitative methodology.</p>
                </div>
            </div>

            <div className="team-section">
                <div className="container">
                    <div className="team-grid">

                        <Reveal className="team-card">
                            <TeamPhoto
                                src="https://www.law.tamu.edu/_assets/images/_profile-images/huyen-pham.jpg"
                                alt="Professor Huyen Pham"
                                initials="HP"
                                affiliation="Texas A&M University School of Law"
                            />
                            <div className="team-body">
                                <h3>Prof. Huyen Pham</h3>
                                <div className="team-title">Professor of Law · Texas A&amp;M University School of Law</div>
                                <p className="team-bio">
                                    Professor Pham is one of the leading scholars in sub-federal immigration law in the United States. Her research examines how state and local governments regulate immigration — and what those regulations mean for immigrant communities, civil rights, and federal-state relations. She is the co-creator of the Immigrant Climate Index and has testified before Congress on immigration enforcement policy.
                                </p>
                                <div className="team-tags">
                                    <span className="team-tag">Immigration Law</span>
                                    <span className="team-tag">Civil Rights</span>
                                    <span className="team-tag">Federalism</span>
                                    <span className="team-tag">Enforcement Policy</span>
                                </div>
                                <div className="team-edu">
                                    <div className="team-edu-label">Education &amp; Positions</div>
                                    <div className="team-edu-item"><span>J.D. — Harvard Law School</span></div>
                                    <div className="team-edu-item"><span>B.A. — University of California, Berkeley</span></div>
                                    <div className="team-edu-item"><span>Professor of Law, Texas A&amp;M School of Law (current)</span></div>
                                    <div className="team-edu-item"><span>Published in <em>NYU Law Review</em>, <em>U. Chicago Law Review</em>, <em>Vanderbilt Law Review</em></span></div>
                                </div>
                            </div>
                        </Reveal>

                        <Reveal className="team-card" delay="0.12s">
                            <TeamPhoto
                                src="https://hankamer.baylor.edu/sites/g/files/ecbvkj336/files/styles/xl/public/2025-09/Van%20Pham.jpg"
                                alt="Professor Van H. Pham"
                                initials="VP"
                                affiliation="Baylor University · Hankamer School of Business"
                            />
                            <div className="team-body">
                                <h3>Prof. Van H. Pham</h3>
                                <div className="team-title">Chair &amp; Professor of Economics · Baylor University</div>
                                <p className="team-bio">
                                    Professor Van Pham is Chair of the Economics Department at Baylor's Hankamer School of Business and an internationally recognised scholar in economic development and immigration. He brings quantitative rigour to the ICI's scoring methodology, drawing on over 25 years of research across immigration economics, health policy, gender in labor markets, and sovereign debt. His work on child labor economics in the <em>American Economic Review</em> has over 3,000 citations.
                                </p>
                                <div className="team-tags">
                                    <span className="team-tag">Development Economics</span>
                                    <span className="team-tag">Immigration</span>
                                    <span className="team-tag">Labor Markets</span>
                                    <span className="team-tag">Health Policy</span>
                                </div>
                                <div className="team-edu">
                                    <div className="team-edu-label">Education &amp; Positions</div>
                                    <div className="team-edu-item"><span>Ph.D. in Economics — Cornell University (1998)</span></div>
                                    <div className="team-edu-item"><span>S.M. in Mechanical Engineering — MIT (1992)</span></div>
                                    <div className="team-edu-item"><span>S.B. in Mechanical Engineering — MIT (1989)</span></div>
                                    <div className="team-edu-item"><span>Fulbright Scholar · World Bank Visiting Researcher</span></div>
                                    <div className="team-edu-item"><span>Tau Beta Pi &amp; Pi Tau Sigma honors, MIT</span></div>
                                </div>
                            </div>
                        </Reveal>

                    </div>
                </div>
            </div>
        </>
    );
}

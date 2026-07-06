import { useEffect, useRef, useState } from 'react';

// Replays the site's scroll-reveal effect: element starts hidden/offset and
// fades+slides into place the first time it enters the viewport.
export default function Reveal({ as: Tag = 'div', delay, className = '', style, children, ...rest }) {
    const ref = useRef(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                setVisible(true);
                observer.unobserve(el);
            }
        }, { threshold: 0.08 });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return (
        <Tag
            ref={ref}
            className={`reveal${visible ? ' visible' : ''}${className ? ` ${className}` : ''}`}
            style={{ ...(delay ? { transitionDelay: delay } : {}), ...style }}
            {...rest}
        >
            {children}
        </Tag>
    );
}

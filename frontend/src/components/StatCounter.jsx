import { useEffect, useRef, useState } from 'react';

export default function StatCounter({ target, suffix = '', duration = 1200 }) {
    const [value, setValue] = useState(0);
    const [counting, setCounting] = useState(false);
    const ref = useRef(null);
    const started = useRef(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting && !started.current) {
                started.current = true;
                setCounting(true);
                const start = performance.now();
                function step(now) {
                    const progress = Math.min((now - start) / duration, 1);
                    const eased = 1 - Math.pow(1 - progress, 3);
                    setValue(Math.floor(eased * target));
                    if (progress < 1) {
                        requestAnimationFrame(step);
                    } else {
                        setCounting(false);
                    }
                }
                requestAnimationFrame(step);
                observer.disconnect();
            }
        }, { threshold: 0.3 });
        observer.observe(el);
        return () => observer.disconnect();
    }, [target, duration]);

    return (
        <div ref={ref} className={`hero-stat-num${counting ? ' counting' : ''}`}>
            {value.toLocaleString()}{suffix}
        </div>
    );
}

import React from 'react';
import { Quote } from 'lucide-react';
import { MARKETING_PLACEHOLDERS } from '../../content/marketing';

export default function TestimonialsSection() {
    const TESTIMONIALS = MARKETING_PLACEHOLDERS.testimonials.filter((testimonial) => testimonial.verified);

    if (TESTIMONIALS.length === 0) return null;

    return (
        <section className="py-20 lg:py-32 bg-canvas">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 text-center mb-10 sm:mb-16 space-y-4">
                <h2 className="text-4xl font-bold font-serif text-ink">What Women Say About Us</h2>
                <div className="flex justify-center gap-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                        <Star key={i} className="w-5 h-5 fill-primary text-primary-container" />
                    ))}
                </div>
            </div>

            <div className="max-w-7xl mx-auto flex snap-x snap-mandatory gap-5 overflow-x-auto px-4 pb-4 sm:px-6 md:grid md:grid-cols-3 md:overflow-visible md:px-8">
                {TESTIMONIALS.map((t, i) => (
                    <article key={i} className="min-w-[86%] snap-center bg-card p-6 sm:p-8 md:min-w-0 md:p-10 rounded-[32px] shadow-sm relative border border-line flex flex-col items-center text-center">
                        <Quote className="absolute top-6 left-6 w-10 h-10 text-ink-muted fill-current" />
                        <p className="text-ink font-body italic mb-6 leading-relaxed">
                            "{t.quote}"
                        </p>
                        <div>
                            <p className="font-serif font-bold text-primary-container">{t.name}</p>
                            <p className="text-[10px] text-ink-muted font-bold uppercase tracking-widest mt-1">{t.role}</p>
                        </div>
                    </article>
                ))}
            </div>
        </section>
    );
}

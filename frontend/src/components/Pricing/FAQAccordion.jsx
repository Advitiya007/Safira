import React, { useState } from 'react';

const FAQ_DATA = [
    { q: 'Is Safira really free?', a: 'Yes! The core SOS and live location features are always free to ensure every woman has access to safety.' },
    { q: 'How does the Guardian Network work in Premium?', a: 'Premium matches you with background-checked local volunteers within a 5km radius to assist in emergencies.' }
];

export default function FAQAccordion() {
    const [openIdx, setOpenIdx] = useState(null);

    const toggle = (idx) => {
        setOpenIdx(openIdx === idx ? null : idx);
    };

    return (
        <div className="max-w-3xl mx-auto space-y-4">
            {FAQ_DATA.map((faq, idx) => (
                <div key={idx} className="border border-line bg-card rounded-lg overflow-hidden shadow-sm">
                    <button
                        className="w-full px-6 py-4 text-left font-serif font-bold text-on-surface flex justify-between items-center bg-canvas hover:bg-soft transition"
                        onClick={() => toggle(idx)}
                    >
                        {faq.q}
                        <span className="material-symbols-outlined text-primary">
                            {openIdx === idx ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
                        </span>
                    </button>

                    {openIdx === idx && (
                        <div className="px-6 py-4 font-body text-on-surface-variant bg-card border-t border-line">
                            {faq.a}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

import React, { useState } from 'react';

const FAQ_DATA = [
  {
    id: 'free-plan',
    question: 'Is Safira free to use?',
    answer: 'Yes! Our Basic Haven plan is completely free. You get access to the safety map, standard SOS alerts, and up to 2 guardians at no cost.',
  },
  {
    id: 'sos',
    question: 'How does the SOS feature work?',
    answer: 'Review the SOS screen and configure your trusted contacts before relying on emergency features. The screen shows the available alert actions.',
  },
  {
    id: 'location',
    question: 'Who can see my live location?',
    answer: 'Use the app’s trusted-contact and tracking controls to review who can access a shared location. Check the sharing state before starting a trip.',
  },
  {
    id: 'offline',
    question: 'Does it work without internet?',
    answer: 'Map, routing, and live-sharing features may require an internet connection. Connectivity requirements can vary by feature and location.',
  },
  {
    id: 'difference',
    question: 'How is sheMaps India different from other safety apps?',
    answer: 'Safira is built to support Indian women with safety tools, trusted-contact connections, and information designed for quick access when it matters.',
  },
  {
    id: 'privacy',
    question: 'Is my personal data safe?',
    answer: 'Review the Privacy & Security settings and your device permissions before sharing personal information or location data.',
  },
];

function FAQItem({ item, isOpen, onToggle }) {
  return (
    <div className={`border-b border-primary-container/8 transition-colors duration-300 ${isOpen ? 'bg-soft/50' : ''}`}>
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={`faq-answer-${item.id}`}
        className="w-full min-h-11 flex items-center justify-between py-6 px-6 text-left"
      >
        <h3 className={`font-headline text-base lg:text-lg font-semibold pr-8 transition-colors duration-300 ${isOpen ? 'text-primary-container' : 'text-ink'}`}>
          {item.question}
        </h3>
        <span className={`material-symbols-outlined text-xl flex-shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180 text-primary-container' : 'text-ink/60'}`}>
          keyboard_arrow_down
        </span>
      </button>
      <div id={`faq-answer-${item.id}`} className="overflow-hidden transition-all duration-300 ease-in-out" style={{ maxHeight: isOpen ? '200px' : '0px' }}>
        <p className="px-6 pb-6 font-body text-ink/60 leading-relaxed">{item.answer}</p>
      </div>
    </div>
  );
}

export default function FAQSection() {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <section className="py-24 bg-card">
      <div className="max-w-[1440px] mx-auto px-6 md:px-12">
        <div className="text-center mb-16">
          <h2 className="font-headline text-4xl lg:text-5xl font-bold text-ink tracking-tight mb-4">Frequently Asked Questions</h2>
          <p className="font-body text-lg text-ink/60">Everything you need to know about Safira.</p>
        </div>
        <div className="max-w-3xl mx-auto rounded-2xl border border-primary-container/8 overflow-hidden">
          {FAQ_DATA.map((item, i) => (
            <FAQItem key={i} item={item} isOpen={openIndex === i} onToggle={() => setOpenIndex(openIndex === i ? -1 : i)} />
          ))}
        </div>
      </div>
    </section>
  );
}

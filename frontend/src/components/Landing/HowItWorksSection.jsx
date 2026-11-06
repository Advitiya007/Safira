import React from 'react';

const STEPS = [
  {
    number: 1,
    icon: 'person_add',
    title: 'Create Your Profile',
    description:
      'Create an account to access the available Safira tools.',
  },
  {
    number: 2,
    icon: 'group_add',
    title: 'Add Your Guardians',
    description:
      'Add people you trust and review the contact information you save.',
  },
  {
    number: 3,
    icon: 'shield_person',
    title: 'Travel with Confidence',
    description:
      'Explore the map and review sharing and SOS options before relying on them.',
  },
];

export default function HowItWorksSection() {
  return (
    <section className="py-24 bg-canvas">
      <div className="max-w-[1440px] mx-auto px-6 md:px-12">
        {/* Heading */}
        <div className="text-center mb-20">
          <h2 className="font-headline text-4xl lg:text-5xl font-bold text-ink tracking-tight mb-4">
            Getting Started is Simple
          </h2>
          <div className="w-20 h-1 bg-primary-container rounded-full mx-auto mb-6"></div>
          <p className="font-body text-lg text-ink/60 max-w-xl mx-auto">
            Set up your account and review the tools available to you.
          </p>
        </div>

        {/* Steps */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-8 relative">
          {/* Dashed connector lines — desktop only */}
          <div className="hidden md:block absolute top-[72px] left-[calc(33.33%_-_16px)] right-[calc(33.33%_-_16px)] h-0 border-t-2 border-dashed border-primary-container/25 z-0"></div>

          {STEPS.map((step) => (
            <div key={step.number} className="flex flex-col items-center text-center relative z-10">
              {/* Number badge */}
              <div className="w-9 h-9 rounded-full bg-primary-container text-white font-label font-bold text-sm flex items-center justify-center mb-5 shadow-lg shadow-primary/30">
                {step.number}
              </div>

              {/* Icon circle */}
              <div className="w-[88px] h-[88px] rounded-full bg-soft border-2 border-primary-container/10 flex items-center justify-center mb-6">
                <span className="material-symbols-outlined text-4xl text-primary-container">
                  {step.icon}
                </span>
              </div>

              {/* Text */}
              <h3 className="font-headline text-xl font-bold text-ink mb-3">
                {step.title}
              </h3>
              <p className="font-body text-ink/60 leading-relaxed max-w-xs">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

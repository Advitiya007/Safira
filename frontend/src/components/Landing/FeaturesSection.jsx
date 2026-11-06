import React from 'react';

export default function FeaturesSection() {
    const features = [
        {
            title: 'Live Safety Map',
            desc: 'Explore mapped facilities and route options. Map coverage can be incomplete, and route indicators are not a guarantee of safety.',
            icon: 'map'
        },
        {
            title: 'SOS Emergency',
            desc: 'Review the SOS actions available in the app and configure trusted contacts before you need them.',
            icon: 'sos'
        },
        {
            title: 'Guardian Network',
            desc: 'Manage the trusted contacts you choose to share trip updates and alerts with.',
            icon: 'group'
        }
    ];

    return (
        <section id="features" className="py-16 sm:py-24 bg-surface-container-low">
            <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-12">
                <div className="text-center max-w-3xl mx-auto mb-16">
                    <h2 className="font-headline text-3xl sm:text-4xl font-bold text-on-surface mb-6 tracking-tight">Tools for your journey</h2>
                    <p className="font-body text-lg text-on-surface-variant">Explore the available features and review their current data and sharing limitations.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {features.map((f, i) => (
                        <div key={i} className="bg-card p-8 rounded-2xl shadow-ambient-rose border border-outline-variant/15 group hover:bg-primary-container hover:shadow-xl hover:scale-[1.02] transition-all duration-500 cursor-default">
                            <div className="w-16 h-16 rounded-full bg-soft flex items-center justify-center mb-8 transition-all duration-500 group-hover:bg-card">
                                <span className="material-symbols-outlined text-2xl text-primary transition-all duration-500 group-hover:scale-110">
                                    {f.icon}
                                </span>
                            </div>
                            <h3 className="font-headline text-2xl font-bold text-on-surface mb-4 group-hover:text-white transition-colors duration-500">{f.title}</h3>
                            <p className="font-body text-on-surface-variant leading-relaxed group-hover:text-white/80 transition-colors duration-500">{f.desc}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

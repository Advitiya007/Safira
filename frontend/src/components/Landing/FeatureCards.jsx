import React from 'react';

const FEATURE_DATA = [
    {
        title: "Live Safety Map",
        description: "Explore mapped facilities and route options. Map coverage can be incomplete, and route indicators are not a guarantee of safety.",
        icon: "map",
        bgColor: "bg-soft",
        iconColor: "text-primary-container"
    },
    {
        title: "SOS Emergency",
        description: "Review the SOS actions available in the app and configure trusted contacts before you need them.",
        icon: "emergency",
        bgColor: "bg-soft",
        iconColor: "text-primary-container"
    },
    {
        title: "Guardian Network",
        description: "Manage the trusted contacts you choose to share trip updates and alerts with.",
        icon: "groups",
        bgColor: "bg-soft",
        iconColor: "text-primary-container"
    }
];

export default function FeatureCards() {
    return (
        <section className="py-24 bg-canvas">
            <div className="container mx-auto px-6">
                <div className="text-center mb-16 max-w-3xl mx-auto space-y-4">
                    <h2 className="font-headline font-bold text-3xl sm:text-4xl lg:text-5xl text-ink">Tools for your journey</h2>
                    <p className="font-body text-ink/60 text-lg">
                        Explore available features and review their current data and sharing limitations.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {FEATURE_DATA.map((feature, idx) => (
                        <div
                            key={idx}
                            className="bg-card rounded-[24px] p-10 space-y-6 shadow-sm border border-soft group hover:bg-primary-container hover:shadow-xl hover:scale-[1.02] transition-all duration-500 cursor-default"
                        >
                            <div className={`w-14 h-14 ${feature.bgColor} rounded-full flex items-center justify-center transition-all duration-500 group-hover:bg-card`}>
                                <span className={`material-symbols-outlined text-2xl fill-1 ${feature.iconColor} transition-all duration-500 group-hover:text-primary-container group-hover:scale-110`}>{feature.icon}</span>
                            </div>
                            <div className="space-y-4">
                                <h3 className="font-headline font-bold text-2xl text-ink transition-colors duration-500 group-hover:text-white">{feature.title}</h3>
                                <p className="font-body text-ink/60 leading-relaxed transition-colors duration-500 group-hover:text-white/80">
                                    {feature.description}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}


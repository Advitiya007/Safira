import React from 'react';
import { Link } from 'react-router-dom';
import { ROUTES } from '../../utils/constants';

export default function HeroSection() {
    return (
        <section className="gradient-hero min-h-[75dvh] lg:min-h-[760px] flex items-center bg-card relative overflow-hidden">
            {/* Decorative gradient overlay handled by CSS in index.css (gradient-hero::after) */}
            <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-12 w-full grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-16 items-center relative z-10 py-12 sm:py-16">
                <div className="lg:col-span-7 space-y-8 animate-in slide-in-from-left duration-700">
                    <div className="inline-flex items-center gap-2 bg-surface-container-high px-4 py-2 rounded-full shadow-ambient-rose">
                        <span className="material-symbols-outlined text-primary text-sm material-symbols-fill">security</span>
                        <span className="font-label text-xs uppercase tracking-widest text-on-surface-variant font-bold">Women-first Safety Platform</span>
                    </div>

                    <h1 className="font-headline text-3xl sm:text-4xl md:text-5xl lg:text-7xl font-extrabold text-on-surface leading-tight tracking-[-0.02em]">
                        Travel <span className="text-primary italic">Fearlessly</span><br />Across India
                    </h1>

                    <p className="font-body text-xl text-on-surface-variant max-w-2xl leading-relaxed">
                        Explore mapped locations, route options, SOS tools, and trusted-contact features for your journey.
                    </p>

                    <div className="flex flex-wrap gap-6 pt-4">
                        <Link
                            to={ROUTES.SIGNUP}
                            className="min-h-11 bg-primary-container text-white font-label font-bold py-3 px-6 sm:py-4 sm:px-8 rounded-lg shadow-3d-primary text-base sm:text-lg active:translate-y-[2px] active:shadow-none transition-all duration-200"
                        >
                            Get Started Free
                        </Link>
                        <a href="#features" className="min-h-11 inline-flex items-center bg-surface-container-high text-primary font-label font-bold py-3 px-6 sm:py-4 sm:px-8 rounded-lg text-base sm:text-lg hover:bg-surface-variant transition-colors duration-200 border border-outline-variant/15">
                            See How It Works
                        </a>
                    </div>

                    <div className="pt-4 sm:pt-8 font-label text-sm text-on-surface-variant">
                        Her journey. Her choice.
                    </div>
                </div>

                <div className="lg:col-span-5 relative hidden lg:block animate-in fade-in zoom-in duration-1000">
                    <div className="relative w-full aspect-[4/5] rounded-[2rem] overflow-hidden shadow-ambient-rose bg-surface-container-lowest border border-outline-variant/15 p-4">
                        <div className="w-full h-full rounded-[1.5rem] overflow-hidden relative flex items-center justify-center p-2">
                            <img
                                alt="Empowering Illustration"
                                className="w-full h-full object-contain"
                                src="https://lh3.googleusercontent.com/aida-public/AB6AXuBo9iFNi-2DFldxsi8LpM0eRqRvQc0DuhkLpEqv6LWIhIEVxgG35khmpXom2sXOrgOAO4gCvutStirDLJAuxWyiG-d6qcwrF1jpv6lIv9A6PEpLDiMOZZjrmErIgGexD-TZBR-v0FvF9QbPKIQVj0OoF-HyAXaSx1VMErdtB5XXtkWdTjtlRbKLbp5rAF6-rHaW_BZFb2wb8QtqXqVnKCD43B6qrfmdzPSwFQS47A8wDa11L7aSKaE5Ji0OI4Bnx_Uaq9-L2S4orzIx"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

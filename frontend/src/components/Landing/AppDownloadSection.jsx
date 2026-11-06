import React from 'react';
import { Link } from 'react-router-dom';
import { ROUTES } from '../../utils/constants';

export default function AppDownloadSection() {
  return (
    <section className="py-24 bg-gradient-to-br from-primary-container to-deep relative overflow-hidden">
      {/* Decorative blobs */}
      <div className="absolute top-10 right-10 w-64 h-64 bg-card/5 rounded-full blur-3xl"></div>
      <div className="absolute bottom-10 left-10 w-80 h-80 bg-card/5 rounded-full blur-3xl"></div>

      <div className="max-w-[1440px] mx-auto px-6 md:px-12 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Left column — Text & Buttons */}
          <div>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-line/60 mb-8">
              <span className="material-symbols-outlined text-sm text-white">
                phone_iphone
              </span>
              <span className="font-label text-xs font-bold text-white uppercase tracking-widest">
                Mobile-friendly web app
              </span>
            </div>

            <h2 className="font-headline text-4xl lg:text-5xl font-bold text-white tracking-tight mb-6 leading-tight">
              Take Safira<br />On Your Journey
            </h2>

            <p className="font-body text-lg text-on-deep/80 leading-relaxed mb-10 max-w-md">
              Access Safira’s safety tools and trusted-contact features from a mobile-friendly web experience.
            </p>

            <Link to={ROUTES.SIGNUP} className="inline-flex min-h-11 items-center rounded-xl bg-card px-6 py-3.5 font-label font-bold text-primary">
              Create an account
            </Link>
          </div>

          {/* Right column — Phone mockup */}
          <div className="hidden lg:flex justify-center">
            <div className="relative w-[280px]">
              {/* Phone frame */}
              <div className="bg-deeper rounded-[40px] p-3 shadow-2xl shadow-black/40 border border-line/60">
                {/* Notch */}
                <div className="absolute top-3 left-1/2 -translate-x-1/2 w-28 h-6 bg-deeper rounded-b-2xl z-20"></div>

                {/* Screen */}
                <div className="bg-canvas rounded-[28px] overflow-hidden">
                  {/* Status bar */}
                  <div className="h-10 bg-deep flex items-center justify-between px-5">
                    <span className="text-[10px] text-white/60 font-label">9:41</span>
                    <div className="flex gap-1.5">
                      <div className="w-3.5 h-2 bg-card/40 rounded-sm"></div>
                      <div className="w-3.5 h-2 bg-card/40 rounded-sm"></div>
                      <div className="w-3.5 h-2 bg-card/40 rounded-sm"></div>
                    </div>
                  </div>

                  {/* App header */}
                  <div className="px-5 pt-4 pb-3 bg-card border-b border-soft">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-primary-container flex items-center justify-center">
                        <span className="material-symbols-outlined text-xs text-white">shield</span>
                      </div>
                      <span className="font-label text-xs font-bold text-ink">Safira</span>
                    </div>
                  </div>

                  {/* Fake map */}
                  <div className="h-48 bg-gradient-to-br from-soft to-soft-2 relative">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="material-symbols-outlined text-5xl text-primary-container/60">map</span>
                    </div>
                    {/* Map dots */}
                    <div className="absolute top-8 left-10 w-2.5 h-2.5 bg-primary-container rounded-full animate-pulse"></div>
                    <div className="absolute top-20 right-12 w-2 h-2 bg-success rounded-full"></div>
                    <div className="absolute bottom-12 left-1/2 w-2 h-2 bg-warning rounded-full"></div>
                  </div>

                  {/* SOS Button */}
                  <div className="px-5 py-5 flex flex-col items-center gap-3">
                    <div className="w-16 h-16 rounded-full bg-error shadow-lg shadow-error/60 flex items-center justify-center">
                      <span className="font-label text-xs font-bold text-white uppercase tracking-wider">SOS</span>
                    </div>
                    <p className="font-label text-[10px] text-ink/60 text-center">Tap for emergency alert</p>
                  </div>

                  {/* Bottom nav */}
                  <div className="flex justify-around px-4 py-3 border-t border-soft">
                    {['home', 'map', 'sos', 'group', 'person'].map((ic, i) => (
                      <span key={i} className={`material-symbols-outlined text-lg ${i === 0 ? 'text-primary-container' : 'text-ink/60'}`}>{ic}</span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Reflection */}
              <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 w-[60%] h-8 bg-card/5 rounded-full blur-xl"></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

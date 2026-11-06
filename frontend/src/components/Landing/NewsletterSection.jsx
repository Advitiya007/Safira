import React from 'react';
import { Link } from 'react-router-dom';
import { ROUTES } from '../../utils/constants';

export default function NewsletterSection() {
  return (
    <section className="py-20 bg-gradient-to-b from-soft to-card">
      <div className="max-w-[640px] mx-auto px-6 text-center">
        <div className="w-16 h-16 rounded-full bg-primary-container/10 flex items-center justify-center mx-auto mb-6">
          <span className="material-symbols-outlined text-3xl text-primary-container">notifications_active</span>
        </div>

        <h2 className="font-headline text-3xl lg:text-4xl font-bold text-ink tracking-tight mb-3">
          Explore Safira
        </h2>
        <p className="font-body text-ink/60 mb-8 leading-relaxed">
          Create an account to view the map, manage trusted contacts, and explore the available wellness resources.
        </p>
        <Link to={ROUTES.SIGNUP} className="inline-flex min-h-11 items-center rounded-lg bg-primary-container px-8 py-3.5 font-label text-sm font-bold text-white hover:bg-primary-hover">
          Get started
        </Link>
      </div>
    </section>
  );
}

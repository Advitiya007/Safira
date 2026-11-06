import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { ROUTES } from '../utils/constants';

export default function NotFound() {
    return (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-canvas">
            <div className="w-24 h-24 bg-primary-container/10 rounded-full flex items-center justify-center text-primary-container mb-8">
                <ShieldAlert className="w-12 h-12" />
            </div>
            <h1 className="text-6xl font-serif font-black text-ink mb-4">404</h1>
            <h2 className="text-2xl font-bold text-primary-container mb-6 font-serif">Page Not Found</h2>
            <p className="text-ink-muted font-body max-w-md mb-10 leading-relaxed">
                It seems you've wandered into an unmapped area. Don't worry, your safety is still our priority. Let's get you back home.
            </p>
            <Link
                to={ROUTES.HOME}
                className="btn-primary inline-flex items-center gap-3 px-8"
            >
                <ArrowLeft className="w-4 h-4" />
                Return to Safety
            </Link>
        </div>
    );
}

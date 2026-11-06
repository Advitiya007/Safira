import React from 'react';

export default function StatsCard({ title, value, icon, color = 'primary' }) {
    const colorMap = {
        primary: 'text-primary-container bg-primary-container/10',
        secondary: 'text-primary-container bg-primary-container/10',
        accent: 'text-info bg-info/10',
        error: 'text-error bg-error/10'
    };

    return (
        <div className="bg-card border border-line rounded-xl p-6 shadow-sm flex items-start gap-4 hover:shadow-md transition">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${colorMap[color]}`}>
                <span className="material-symbols-outlined">{icon}</span>
            </div>
            <div>
                <p className="font-body text-sm text-on-surface-variant font-medium">{title}</p>
                <p className="font-serif text-2xl font-bold text-on-surface">{value}</p>
            </div>
        </div>
    );
}

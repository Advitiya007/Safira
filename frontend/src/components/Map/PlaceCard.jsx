import React from 'react';

export default function PlaceCard({ poi }) {
    const getIcon = (type) => {
        switch (type) {
            case 'police': return 'shield';
            case 'hospital': return 'local_hospital';
            default: return 'home';
        }
    };

    const getColors = (type) => {
        switch (type) {
            case 'police': return 'bg-info/10 text-info';
            case 'hospital': return 'bg-error/10 text-error';
            default: return 'bg-primary-container/10 text-primary-container';
        }
    };

    return (
        <div className="bg-card p-4 rounded-xl shadow-sm hover:shadow-md transition cursor-pointer border border-line">
            <div className="flex items-center space-x-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${getColors(poi.type)}`}>
                    <span className="material-symbols-outlined">{getIcon(poi.type)}</span>
                </div>
                <div>
                    <h3 className="font-serif font-bold text-sm text-on-surface line-clamp-1">{poi.name}</h3>
                    <p className="font-body text-[10px] font-bold text-on-surface-variant mt-1 tracking-wider uppercase">{poi.type}</p>
                </div>
            </div>
        </div>
    );
}

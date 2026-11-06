import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Map as MapIcon, ShieldAlert, Users, Leaf } from 'lucide-react';

export default function MobileBottomNav() {
    const location = useLocation();
    const currentPath = location.pathname;

    const navItems = [
        { path: '/dashboard', icon: Home, label: 'Home' },
        { path: '/map', icon: MapIcon, label: 'Map' },
        { path: '/sos', icon: ShieldAlert, label: 'SOS', isCenter: true },
        { path: '/guardians', icon: Users, label: 'Guardians' },
        { path: '/wellness', icon: Leaf, label: 'Wellness' }
    ];

    return (
        <nav aria-label="Main mobile navigation" className="fixed bottom-0 left-0 w-full min-h-16 bg-card border-t border-line md:hidden z-50 flex items-center justify-around gap-1 px-2 pb-safe shadow-[0_-4px_20px_rgb(0_0_0_/_0.08)]">
            {navItems.map((item) => {
                const isActive = currentPath === item.path;
                const Icon = item.icon;

                if (item.isCenter) {
                    return (
                        <Link 
                            key={item.path} 
                            to={item.path} 
                            aria-label="Open SOS emergency"
                            className="relative -mt-6 flex min-h-16 min-w-14 flex-col items-center justify-center group"
                        >
                            <div className="w-[52px] h-[52px] bg-error rounded-full flex items-center justify-center shadow-xl shadow-error/30 transition-transform">
                                <Icon className="w-6 h-6 text-white" />
                            </div>
                            <span className="text-[10px] font-bold text-error mt-1 uppercase tracking-widest">{item.label}</span>
                        </Link>
                    );
                }

                return (
                    <Link 
                        key={item.path} 
                        to={item.path} 
                        aria-current={isActive ? 'page' : undefined}
                        className={`flex min-h-11 min-w-14 flex-col items-center justify-center gap-1 transition-colors ${isActive ? 'text-primary-container' : 'text-ink-muted'}`}
                    >
                        <Icon className="w-6 h-6" />
                        <span className={`text-[10px] font-bold uppercase tracking-widest ${isActive ? 'text-primary-container' : 'text-ink-muted'}`}>
                            {item.label}
                        </span>
                        {/* Active dot indicator */}
                        <div className={`w-1 h-1 rounded-full mt-0.5 transition-all ${isActive ? 'bg-primary-container scale-100' : 'bg-transparent scale-0'}`} />
                    </Link>
                );
            })}
        </nav>
    );
}

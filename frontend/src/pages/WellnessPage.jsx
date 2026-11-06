import React, { useState } from 'react';
import { Search, Filter, Clock, ArrowRight, Bookmark, Share2, CheckCircle, Heart, Sparkles, Shield, Compass, Dumbbell, Brain } from 'lucide-react';
import { WELLNESS_GUIDES } from '../data/wellnessGuides';
export default function WellnessPage() {
    const [activeCategory, setActiveCategory] = useState('All');
    const [searchQuery, setSearchQuery] = useState('');
    const [savedGuides, setSavedGuides] = useState([]);
    const [isExpanded, setIsExpanded] = useState(false);
    const [toast, setToast] = useState(null);
    const [hoveredCard, setHoveredCard] = useState(null);
    const CATEGORIES = [
        { name: 'All', icon: Sparkles },
        { name: 'Mental Health', icon: Brain },
        { name: 'Physical Safety', icon: Shield },
        { name: 'Travel Tips', icon: Compass },
        { name: 'Self Defense', icon: Dumbbell }
    ];
    const filteredGuides = WELLNESS_GUIDES.filter(g => {
        const matchesCategory = activeCategory === 'All' || g.category === activeCategory;
        const matchesSearch = g.title.toLowerCase().includes(searchQuery.toLowerCase())
            || g.desc.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesCategory && matchesSearch;
    });
    const toggleBookmark = (id) => {
        if (savedGuides.includes(id)) {
            setSavedGuides(savedGuides.filter(savedId => savedId !== id));
        } else {
            setSavedGuides([...savedGuides, id]);
        }
    };
    const handleShare = async (guide) => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: guide.title,
                    text: guide.desc,
                    url: window.location.href,
                });
            } catch (err) {
                console.error('Error sharing', err);
            }
        } else {
            navigator.clipboard.writeText(window.location.href);
            setToast('Link copied!');
            setTimeout(() => setToast(null), 2000);
        }
    };
    return (
        <div className="min-h-screen relative bg-gradient-to-b from-canvas via-soft to-canvas">
            {/* Toast Notification */}
            {toast && (
                <div role="status" aria-live="polite" className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-50 bg-card text-ink border border-line px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-4">
                    <CheckCircle className="w-5 h-5 text-success" />
                    <span className="font-label text-sm font-semibold">{toast}</span>
                </div>
            )}
            {/* Decorative blobs */}
            <div className="absolute top-20 left-10 w-72 h-72 rounded-full opacity-20 blur-3xl pointer-events-none bg-primary/20" />
            <div className="absolute top-96 right-10 w-96 h-96 rounded-full opacity-15 blur-3xl pointer-events-none bg-info/20" />
            <div className="absolute bottom-40 left-1/4 w-80 h-80 rounded-full opacity-10 blur-3xl pointer-events-none bg-warning/20" />
            <div className="max-w-7xl mx-auto px-8 py-12 relative z-10">
                {/* Hero Header */}
                <header className="mb-16 text-center max-w-3xl mx-auto">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-6 bg-primary/10 border border-primary/20">
                        <Heart className="w-4 h-4 text-primary-container" />
                        <span className="text-xs font-bold uppercase tracking-[0.2em] text-primary-container">Safira Wellness</span>
                        {savedGuides.length > 0 && (
                            <span className="bg-primary-container text-white px-2 py-0.5 rounded-full text-[10px] font-bold ml-1">
                                {savedGuides.length} saved
                            </span>
                        )}
                    </div>
                    <h1 className="text-5xl md:text-6xl font-bold font-serif text-ink tracking-tight leading-[1.1] mb-6">
                        Her Journey,<br />
                        <span className="text-primary-container">Her Choice</span>
                    </h1>
                    <p className="text-lg text-ink-muted font-body max-w-xl mx-auto leading-relaxed">
                        Wellness and safety resources to support your choices, your well-being, and every step of your journey.
                    </p>
                    {/* Search */}
                    <div className="relative w-full max-w-md mx-auto mt-8">
                        <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-ink-muted" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search wellness guides..."
                            className="w-full pl-14 pr-6 py-4 bg-card/80 backdrop-blur-xl border border-line/60 rounded-2xl outline-none focus:border-primary-container focus:shadow-lg focus:shadow-primary/10 transition-all text-sm"
                            style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}
                        />
                    </div>
                </header>
                {/* Featured Article — Immersive Hero Card */}
                <div className="mb-16 relative rounded-[2rem] overflow-hidden group cursor-pointer" style={{ minHeight: '420px', boxShadow: '0 25px 60px rgba(45,27,46,0.2)' }}>
                    <img
                        src="https://images.unsplash.com/photo-1596394516093-501ba68a0ba6?auto=format&fit=crop&q=80&w=1200"
                        alt="Featured Guide"
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-[1.5s]"
                    />
                    <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, rgba(45,27,46,0.92) 0%, rgba(45,27,46,0.7) 40%, rgba(45,27,46,0.3) 100%)' }} />
                    <div className="relative z-10 p-12 md:p-16 flex flex-col justify-end h-full" style={{ minHeight: '420px' }}>
                        <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-[0.15em] w-fit mb-6" style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))', color: 'white' }}>
                            <Sparkles className="w-3.5 h-3.5" /> Featured Guide
                        </span>
                        <h2 className="text-4xl md:text-5xl font-serif font-bold text-white leading-tight mb-4 max-w-2xl">
                            The Modern Woman's Handbook to Safe Commuting
                        </h2>
                        <p className="text-ink-muted font-body text-lg leading-relaxed max-w-xl mb-8">
                            From cab protocols to transit apps, we break down every layer of safety needed for your daily journey.
                        </p>
                        {/* Expandable Content */}
                        <div className={`overflow-hidden transition-all duration-700 ease-in-out ${isExpanded ? 'max-h-[500px] opacity-100 mb-6' : 'max-h-0 opacity-0'}`}>
                            <div className="p-6 rounded-2xl" style={{ background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(10px)' }}>
                                <p className="text-ink-muted font-body text-sm leading-relaxed mb-4">
                                    Navigating daily commutes in bustling cities requires more than just awareness—it requires a system. Before entering any cab, always verify the driver's details against your app. Cross-check the license plate, the driver's photo, and ensure the child lock on your door is disabled.
                                </p>
                                <p className="text-ink-muted font-body text-sm leading-relaxed mb-4">
                                    Public transit poses different challenges. Stick to well-lit compartments and sit near the exit or transit staff. If you feel uneasy, trust your gut. Move to another carriage or get off at the next populated stop.
                                </p>
                                <p className="text-ink-muted font-body text-sm leading-relaxed">
                                    Finally, share your live location with a trusted contact when you choose. Safira's live tracking can share location updates while the feature is active and connected.
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => setIsExpanded(!isExpanded)}
                            className="inline-flex items-center gap-3 px-8 py-3.5 rounded-xl font-bold text-sm uppercase tracking-widest w-fit transition-all duration-300 group/btn"
                            style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))', color: 'white', boxShadow: '0 8px 32px color-mix(in srgb, var(--color-primary) 35%, transparent)' }}
                        >
                            {isExpanded ? 'Collapse Article' : 'Read Full Article'}
                            <ArrowRight className={`w-4 h-4 transition-transform duration-500 ${isExpanded ? 'rotate-90' : 'group-hover/btn:translate-x-1'}`} />
                        </button>
                    </div>
                </div>
                {/* Category Pills — Floating style */}
                <div className="flex flex-wrap justify-center gap-3 mb-12">
                    {CATEGORIES.map(cat => {
                        const Icon = cat.icon;
                        return (
                            <button
                                key={cat.name}
                                onClick={() => setActiveCategory(cat.name)}
                                className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold transition-all duration-300 ${activeCategory === cat.name
                                        ? 'text-white shadow-lg scale-105'
                                        : 'bg-card/70 backdrop-blur-sm border border-line/60 text-ink-muted hover:border-primary-container/40 hover:bg-card'
                                    }`}
                                style={activeCategory === cat.name ? { background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-container))', boxShadow: '0 8px 24px color-mix(in srgb, var(--color-primary) 30%, transparent)' } : {}}
                            >
                                <Icon className="w-4 h-4" />
                                {cat.name}
                                <span className={`text-xs ${activeCategory === cat.name ? 'text-white/70' : 'text-ink-muted'}`}>
                                    ({cat.name === 'All' ? WELLNESS_GUIDES.length : WELLNESS_GUIDES.filter(g => g.category === cat.name).length})
                                </span>
                            </button>);
                    })}               </div>
                <p className="text-center text-xs font-bold text-ink-muted uppercase tracking-[0.2em] mb-10">
                    {filteredGuides.length} guide{filteredGuides.length !== 1 && 's'} available
                </p>
                {/* Guides Grid — Staggered Bento Style */}
                {filteredGuides.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center bg-card/60 backdrop-blur-xl rounded-3xl border-2 border-dashed border-line">
                        <div className="w-16 h-16 bg-canvas rounded-full flex items-center justify-center mb-4">
                            <Search className="w-8 h-8 text-ink-muted" />
                        </div>
                        <h3 className="text-xl font-bold font-serif text-ink mb-2">No guides found</h3>
                        <p className="text-ink-muted max-w-sm">We couldn't find any guides matching "{searchQuery}". Try adjusting your search or category filter.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredGuides.map((guide, index) => (
                            <div
                                key={guide.id}
                                className={`group relative bg-card/70 backdrop-blur-xl rounded-[1.5rem] overflow-hidden transition-all duration-500 hover:-translate-y-2 ${index === 0 ? 'md:col-span-2 md:row-span-1' : ''
                                    }`}
                                style={{
                                    boxShadow: hoveredCard === guide.id
                                        ? `0 20px 50px rgb(var(--${guide.accent}) / 0.15), 0 0 0 1px rgb(var(--${guide.accent}) / 0.12)`
                                        : '0 4px 20px rgb(var(--ink) / 0.08)',
                                    border: '1px solid rgb(var(--line))'
                                }}
                                onMouseEnter={() => setHoveredCard(guide.id)}
                                onMouseLeave={() => setHoveredCard(null)}  >
                                <div className={`relative overflow-hidden ${index === 0 ? 'h-56 md:h-64' : 'h-48'}`}>
                                    <img
                                        src={guide.image}
                                        alt={guide.title}
                                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />

                                    {/* Category chip */}
                                    <span
                                        className="absolute top-4 left-4 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest text-white shadow-lg backdrop-blur-md"
                                        style={{ background: `rgb(var(--${guide.accent}) / 0.8)` }}
                                    >
                                        {guide.category}
                                    </span>

                                    {/* Read time */}
                                    <span className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold text-white bg-black/40 backdrop-blur-md">
                                        <Clock className="w-3 h-3" /> {guide.time}
                                    </span>
                                </div>
                                <div className="p-6 space-y-3">
                                    <h3 className={`font-bold font-serif text-ink group-hover:text-primary-container transition-colors leading-tight ${index === 0 ? 'text-2xl' : 'text-lg'}`}>
                                        {guide.title}
                                    </h3>
                                    <p className="text-sm text-ink-muted line-clamp-2 font-body leading-relaxed">
                                        {guide.desc}
                                    </p>
                                    <div className="flex items-center justify-between pt-4">
                                        <button className="flex items-center gap-2 text-primary-container font-bold text-xs uppercase tracking-widest hover:gap-3 transition-all">
                                            Read More <ArrowRight className="w-3.5 h-3.5" />
                                        </button>
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={() => toggleBookmark(guide.id)}
                                                className={`p-2 rounded-xl transition-all ${savedGuides.includes(guide.id) ? 'bg-soft text-primary-container scale-110' : 'text-ink-muted hover:text-primary-container hover:bg-canvas'}`}
                                            >
                                                <Bookmark className="w-4 h-4" fill={savedGuides.includes(guide.id) ? 'var(--color-primary)' : 'none'} />
                                            </button>
                                            <button
                                                onClick={() => handleShare(guide)}
                                                className="p-2 text-ink-muted hover:text-primary-container hover:bg-canvas rounded-xl transition-all"
                                            >
                                                <Share2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {/* Bottom CTA */}
                <div className="mt-20 text-center">
                    <div className="inline-flex flex-col items-center gap-4 p-10 rounded-[2rem]" style={{ background: 'color-mix(in srgb, var(--color-primary) 6%, white)', border: '1px solid color-mix(in srgb, var(--color-primary) 10%, transparent)' }}>
                        <Shield className="w-8 h-8 text-primary-container" />
                        <h3 className="text-2xl font-serif font-bold text-ink">Want to contribute a guide?</h3>
                        <p className="text-ink-muted max-w-md text-sm">Share your safety tips and wellness advice to help women across India stay informed and empowered.</p>
                        <button className="mt-2 px-8 py-3 rounded-xl text-white font-bold text-sm uppercase tracking-widest transition-all hover:scale-105" style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-container))', boxShadow: '0 8px 24px color-mix(in srgb, var(--color-primary) 30%, transparent)' }}>
                            Submit a Guide
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
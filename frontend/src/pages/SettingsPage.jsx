import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { User, Bell, Shield, Info, CheckCircle, Loader2 } from 'lucide-react';
import { userAPI } from '../utils/api';

export default function SettingsPage() {
    const { user, logout, refreshUser } = useAuth();
    const [activeTab, setActiveTab] = useState('profile');
    
    // Profile State
    const [formData, setFormData] = useState({ fullName: '', email: '', phone: '' });
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState(null);

    useEffect(() => {
        if (user) {
            setFormData({
                fullName: user.fullName || '',
                email: user.email || '',
                phone: user.phone || ''
            });
        }
    }, [user]);

    // Toast auto-hide
    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => setToast(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [toast]);

    const showToast = (message, type = 'success') => {
        setToast({ message, type });
    };

    const handleProfileSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const response = await userAPI.updateProfile(formData);
            if (response.success) {
                await refreshUser();
                showToast('Profile updated successfully!');
            }
        } catch (error) {
            showToast(error.message || 'Failed to update profile', 'error');
        } finally {
            setSaving(false);
        }
    };

    const tabs = [
        { id: 'profile', label: 'Profile', icon: User },
        { id: 'notifications', label: 'Notifications', icon: Bell },
        { id: 'privacy', label: 'Privacy & Security', icon: Shield },
        { id: 'about', label: 'About', icon: Info },
    ];

    return (
        <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:px-8 lg:py-12 relative">
            {/* Toast Notification */}
            {toast && (
                <div role="status" aria-live="polite" className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-[2000] bg-card text-ink border border-line px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-4">
                    <CheckCircle className={`w-5 h-5 ${toast.type === 'error' ? 'text-error' : 'text-success'}`} />
                    <span className="font-label text-sm font-semibold">{toast.message}</span>
                </div>
            )}

            <header className="mb-6 sm:mb-10">
                <h1 className="text-3xl sm:text-4xl font-bold font-serif text-primary-container mb-3 tracking-tight">Settings</h1>
                <p className="text-ink-muted font-body text-base sm:text-lg">Manage your account preferences and personal information.</p>
            </header>

            <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-4 lg:gap-8">
                {/* Sidebar Navigation */}
                <div role="tablist" aria-label="Settings sections" className="flex min-w-0 gap-2 overflow-x-auto overscroll-x-contain pb-2 lg:col-span-1 lg:flex-col lg:overflow-visible">
                    {tabs.map((tab) => {
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                type="button"
                                role="tab"
                                id={`settings-tab-${tab.id}`}
                                aria-selected={activeTab === tab.id}
                                aria-controls="settings-panel"
                                className={`flex min-h-11 shrink-0 items-center gap-2 px-4 py-3 rounded-xl text-sm font-bold transition-all text-left lg:w-full lg:gap-3 lg:px-5 lg:py-4 lg:rounded-2xl ${
                                    activeTab === tab.id
                                        ? 'bg-primary-container text-white shadow-lg shadow-primary/20'
                                        : 'bg-card text-ink-muted hover:bg-soft hover:text-primary-container'
                                }`}
                            >
                                <Icon className="w-5 h-5" />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>

                {/* Main Content Area */}
                <div className="min-w-0 lg:col-span-3">
                    <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${activeTab}`} className="bg-card rounded-2xl sm:rounded-[2rem] p-4 sm:p-6 lg:p-8 shadow-sm border border-line min-h-[500px]">
                        
                        {/* Profile Tab */}
                        {activeTab === 'profile' && (
                            <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
                                <h2 className="text-2xl font-bold font-serif text-ink mb-6">Profile Information</h2>
                                <form onSubmit={handleProfileSubmit} className="space-y-6 max-w-xl">
                                    <div className="space-y-2">
                                        <label htmlFor="settings-full-name" className="text-xs font-bold text-ink-muted uppercase tracking-wider">Full Name</label>
                                        <input
                                            type="text"
                                            id="settings-full-name"
                                            value={formData.fullName}
                                            onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                                            className="w-full p-3.5 bg-canvas border border-line rounded-xl focus:bg-card focus:border-primary-container outline-none transition-all text-ink"
                                            placeholder="Your name"
                                            required
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label htmlFor="settings-email" className="text-xs font-bold text-ink-muted uppercase tracking-wider">Email Address</label>
                                        <input
                                            type="email"
                                            id="settings-email"
                                            value={formData.email}
                                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                            className="w-full p-3.5 bg-canvas border border-line rounded-xl focus:bg-card focus:border-primary-container outline-none transition-all text-ink"
                                            placeholder="your@email.com"
                                            required
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label htmlFor="settings-phone" className="text-xs font-bold text-ink-muted uppercase tracking-wider">Phone Number</label>
                                        <input
                                            type="tel"
                                            id="settings-phone"
                                            value={formData.phone}
                                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                            className="w-full p-3.5 bg-canvas border border-line rounded-xl focus:bg-card focus:border-primary-container outline-none transition-all text-ink"
                                            placeholder="+91 XXXXXXXXXX"
                                        />
                                    </div>
                                    <button 
                                        type="submit" 
                                        disabled={saving}
                                        className="mt-4 py-3.5 px-8 bg-primary-container hover:bg-primary-hover text-white font-bold rounded-xl transition-all shadow-lg shadow-primary/20 disabled:opacity-70 flex items-center gap-2"
                                    >
                                        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                                        Save Changes
                                    </button>
                                </form>
                            </div>
                        )}

                        {/* Notifications Tab */}
                        {activeTab === 'notifications' && (
                            <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
                                <h2 className="text-2xl font-bold font-serif text-ink mb-6">Notification Preferences</h2>
                                <div className="space-y-2">
                                    {[
                                        { label: 'SOS Alerts', desc: 'Get notified for emergency alerts', default: true },
                                        { label: 'Guardian Updates', desc: 'Notifications from your guardian network', default: true },
                                        { label: 'Safety Tips', desc: 'Daily safety tips and news', default: false },
                                        { label: 'App Updates', desc: 'New features and improvements', default: false },
                                    ].map((item, i) => (
                                        <div key={i} className="flex items-center justify-between py-4 border-b border-line last:border-0">
                                            <div>
                                                <p className="font-bold text-ink">{item.label}</p>
                                                <p className="text-sm text-ink-muted">{item.desc}</p>
                                            </div>
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input type="checkbox" defaultChecked={item.default} className="sr-only peer" />
                                                <div className="w-11 h-6 bg-soft peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-line after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-card after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-container"></div>
                                            </label>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Privacy Tab */}
                        {activeTab === 'privacy' && (
                            <div className="animate-in fade-in slide-in-from-bottom-4 duration-300 space-y-10">
                                <div>
                                    <h2 className="text-2xl font-bold font-serif text-ink mb-6">Privacy & Security</h2>
                                    <div className="space-y-2">
                                        {[
                                            { label: 'Share location with guardians', desc: 'Allow guardians to see your live location', default: true },
                                            { label: 'Anonymous reporting', desc: 'Hide your identity when reporting incidents', default: false },
                                            { label: 'Two-factor authentication', desc: 'Add extra security to your account', default: false },
                                        ].map((item, i) => (
                                            <div key={i} className="flex items-center justify-between py-4 border-b border-line last:border-0">
                                                <div>
                                                    <p className="font-bold text-ink">{item.label}</p>
                                                    <p className="text-sm text-ink-muted">{item.desc}</p>
                                                </div>
                                                <label className="relative inline-flex items-center cursor-pointer">
                                                    <input type="checkbox" defaultChecked={item.default} className="sr-only peer" />
                                                    <div className="w-11 h-6 bg-soft peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-line after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-card after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-container"></div>
                                                </label>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                
                                <div className="pt-8 border-t border-error/20">
                                    <h3 className="text-lg font-bold text-error mb-2">Danger Zone</h3>
                                    <p className="text-sm text-ink-muted mb-4">Logging out will stop background tracking and real-time notifications on this device.</p>
                                    <button
                                        onClick={logout}
                                        className="px-6 py-3 bg-error/10 hover:bg-error/10 text-error font-bold rounded-xl border border-error/20 transition-all uppercase tracking-widest text-xs"
                                    >
                                        Log Out Securely
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* About Tab */}
                        {activeTab === 'about' && (
                            <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
                                <h2 className="text-2xl font-bold font-serif text-ink mb-6">About Safira</h2>
                                <div className="bg-soft rounded-2xl p-6 border border-primary-container/10">
                                    <div className="flex items-center gap-3 mb-4">
                                        <Shield className="w-8 h-8 text-primary-container" />
                                        <h3 className="text-xl font-bold font-serif text-primary-container">Safira</h3>
                                    </div>
                                    <p className="text-ink-muted leading-relaxed mb-6">
                                        Safira is a women's safety and wellness platform designed to support informed choices, community connections, and emergency assistance.
                                    </p>
                                    <div className="space-y-3 text-sm font-medium">
                                        <div className="flex justify-between py-2 border-b border-line/60">
                                            <span className="text-ink-muted">Version</span>
                                            <span className="text-ink font-bold">1.0.0 (Beta)</span>
                                        </div>
                                        <div className="flex justify-between py-2 border-b border-line/60">
                                            <span className="text-ink-muted">Built By</span>
                                            <span className="text-ink font-bold">Safira Team</span>
                                        </div>
                                        <div className="flex justify-between py-2 border-b border-line/60">
                                            <span className="text-ink-muted">Privacy Policy</span>
                                            <a href="#" className="text-primary-container hover:underline">View Policy</a>
                                        </div>
                                        <div className="flex justify-between py-2">
                                            <span className="text-ink-muted">Terms of Service</span>
                                            <a href="#" className="text-primary-container hover:underline">View Terms</a>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
